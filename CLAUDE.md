# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open-LLM-VTuber is a voice-interactive AI companion with Live2D avatar support that runs completely offline. It's a cross-platform Python application supporting real-time voice conversations, visual perception, and Live2D character animations, with modular LLM/ASR/TTS/VAD backends.

This fork also carries a downstream customization: an AI English tutor for young children ("child companion" / preschool teacher characters), built on a Qwen audio-to-audio realtime voice path and shipped as a Capacitor mobile app (`ai.english.tutor`). Plans for this work live in `doc/plans/` (dated markdown files). Upstream is in a **v2.0 rewrite freeze** — see the notice at the top of `README.md` — so v1 changes here should stay bug-fix/fork-feature scoped rather than large architectural rewrites, unless you're deliberately working on the v2 plan.

## Essential Commands

### Development Setup
- **Install dependencies**: `uv sync` (uses uv package manager)
- **Run server**: `uv run run_server.py`
- **Run with verbose logging**: `uv run run_server.py --verbose`
- **Update project**: `uv run upgrade.py`

### Code Quality
- **Lint code**: `ruff check .`
- **Format code**: `ruff format .`
- **Run pre-commit hooks**: `pre-commit run --all-files`

### Tests
- **Run all tests**: `uv run python -m unittest discover -s test`
- **Run a single test module**: `uv run python -m unittest test.test_mobile_access_token`
- Tests are plain `unittest` (no pytest, no test runner config in `pyproject.toml`). They live in `test/` and are thin — e.g. `test_mobile_access_token.py` covers `routes.is_valid_mobile_access_token`, `test_child_companion_character.py` asserts invariants on a character YAML, `test_qwen_realtime.py` exercises `realtime/qwen_realtime.py` against a fake upstream websocket. Follow this style (small, targeted, no fixtures/frameworks) when adding tests rather than introducing a new test framework.

### Server Configuration
- **Main config file**: `conf.yaml` (user configuration)
- **Default configs**: `config_templates/conf.default.yaml` and `config_templates/conf.ZH.default.yaml`
- **Character configs**: `characters/` directory (YAML files)

### Mobile app (Capacitor, `mobile/`)
See `mobile/README.md` for full details (written in Chinese). Summary:
- `mobile/` is a Capacitor 8 shell (Android + iOS) that packages the same web frontend built with `VITE_MOBILE_APP=1`.
- Test backend: copy `mobile/.env.test.example` to `.env` at repo root with `DASHSCOPE_API_KEY` and a random `MOBILE_ACCESS_TOKEN`, then `docker compose -f docker-compose.mobile-test.yml up -d --build`. The compose stack runs the server with `MOBILE_TEST_MODE=1`, which disables CORS credentials, the web tool, and proxy routes, and adds a bare `/healthz` endpoint (see `WebSocketServer.__init__` in `server.py`).
- The mobile client must send an `auth` message with the matching token before any other WebSocket traffic is accepted (`is_valid_mobile_access_token` in `routes.py`); this token is for single-device private testing only, not store releases.
- Device builds: `cd mobile && corepack pnpm run sync:android-ip-test && corepack pnpm run open:android` (Android), or the `:ios-ip-test` equivalent for iOS — both require `MOBILE_ACCESS_TOKEN` exported and only enable plaintext HTTP/WS to a hardcoded test IP in debug builds. Release builds must go through `corepack pnpm run sync` with a real `VITE_BACKEND_URL=https://...` TLS domain.

## Architecture Overview

### Core Components

**WebSocket Server** (`src/open_llm_vtuber/server.py`):
- FastAPI-based server handling WebSocket connections
- Serves frontend, Live2D models, and static assets
- Supports both main client and proxy WebSocket endpoints
- `MOBILE_TEST_MODE=1` switches it into a minimal mode for the mobile test backend (see above)

**Service Context** (`src/open_llm_vtuber/service_context.py`):
- Central dependency injection container
- Manages all engines (LLM, ASR, TTS, VAD, etc.)
- Each WebSocket connection gets its own service context instance

**WebSocket Handler** (`src/open_llm_vtuber/websocket_handler.py`):
- Routes WebSocket messages to appropriate handlers via a `MessageType` enum and a `_handle_*` dispatch table built in `_init_message_handlers()`
- Manages client connections, groups, and conversation state
- Handles audio data, conversation triggers, and Live2D interactions
- Also dispatches the realtime audio-to-audio protocol (`connect`/`unmute`/`mute`, `audio.append`, `text.message`, `playback.started/ended/cancelled`) used by the Qwen realtime path

**Proxy Handler** (`src/open_llm_vtuber/proxy_handler.py`, `proxy_message_queue.py`):
- A relay/IPC hub letting multiple independent clients (e.g. a web client and a live-streaming platform client) share a single upstream WebSocket connection to the server, exposed at `/proxy-ws` (see `init_proxy_route` in `routes.py`). Only mounted when `system_config.enable_proxy` is set and not in mobile test mode.

### Modular Engine System

The project uses a factory pattern for all AI engines:

**Agent System** (`src/open_llm_vtuber/agent/`):
- `agent_factory.py` - Factory for creating different agent types
- `agents/` - Various agent implementations (basic_memory, hume_ai, letta, mem0)
- `stateless_llm/` - Stateless LLM implementations (Claude, OpenAI, Ollama, etc.)

**Realtime voice** (`src/open_llm_vtuber/realtime/qwen_realtime.py`):
- A separate audio-to-audio path (not the ASR→LLM→TTS pipeline) that relays client audio directly to Qwen's realtime WebSocket API and streams audio back. Config lives in `RealtimeVoiceConfig` / `TeachingSessionConfig` (`config_manager/character.py`) on the character YAML.
- `TeachingSessionConfig` is server-owned, trusted lesson context (age, level, topic, target words/phrase) that gets appended to the character's `persona_prompt` via `build_qwen_instructions` — it is never taken from untrusted client input, since it's injected straight into the model instructions.

**ASR Engines** (`src/open_llm_vtuber/asr/`):
- Support for multiple ASR backends: Sherpa-ONNX, FunASR, Faster-Whisper, OpenAI Whisper, etc.
- Factory pattern for engine selection based on configuration

**TTS Engines** (`src/open_llm_vtuber/tts/`):
- Multiple TTS options: Azure TTS, Edge TTS, MeloTTS, CosyVoice, GPT-SoVITS, etc.
- Configurable voice cloning and multi-language support

**VAD (Voice Activity Detection)** (`src/open_llm_vtuber/vad/`):
- Silero VAD for detecting speech activity
- Essential for voice interruption without feedback loops

**Live streaming integration** (`src/open_llm_vtuber/live/`):
- `bilibili_live.py` connects to Bilibili Live danmaku/chat via `live_interface.py`, feeding live-platform messages into the conversation pipeline (paired with the proxy handler above).

### Configuration Management

**Config System** (`src/open_llm_vtuber/config_manager/`):
- Type-safe (Pydantic) configuration classes for each component, loaded/validated from YAML
- Support for multiple character configurations and config switching
- `i18n.py` provides `MultiLingualString`/`I18nMixin` so individual **config field labels/descriptions** can carry en/zh translations for the config UI. This is unrelated to the frontend's own i18n system (`frontend/src/renderer/src/i18n.ts`, i18next) which translates the UI copy itself — don't conflate the two when touching translations.

### Conversation System

**Conversation Handling** (`src/open_llm_vtuber/conversations/`):
- `conversation_handler.py` - Main conversation orchestration
- `single_conversation.py` - Individual user conversations
- `group_conversation.py` - Multi-user group conversations
- `tts_manager.py` - Audio streaming and TTS management

### MCP (Model Context Protocol) Integration

**MCP System** (`src/open_llm_vtuber/mcpp/`):
- Tool execution and server registry
- JSON detection and parameter extraction
- Integration with various MCP servers for extended functionality

## Key Development Patterns

### Live2D Integration
- Models stored in `live2d-models/` directory
- Each model has its own `.model3.json` configuration
- Expression and motion control through WebSocket messages

### Audio Processing
- Real-time audio streaming through WebSocket
- Voice interruption support without headphones
- Multi-format audio support with proper codec handling

## Important File Locations

- **Entry point**: `run_server.py`
- **Main server**: `src/open_llm_vtuber/server.py`
- **WebSocket routing**: `src/open_llm_vtuber/routes.py`
- **Configuration**: `conf.yaml` (user), `config_templates/` (defaults)
- **Frontend**: `frontend/` — tracked directly in this repo (no longer a git submodule; see `chore: track frontend in main repository`). It's an Electron + React app; see `frontend/CLAUDE.md` for its own dev commands and architecture.
- **Mobile app**: `mobile/` — Capacitor shell around the same frontend web build, see Mobile app section above
- **Live2D models**: `live2d-models/`
- **Character definitions**: `characters/` (includes the child-tutor personas: `en_child_companion.yaml`, `en_child_english_teacher.yaml`)
- **Chat history**: `chat_history/`
- **Cache**: `cache/` (audio files, temporary data)
- **Fork planning docs**: `doc/plans/` (dated markdown design docs for the tutor/mobile/realtime work)

## Development Guidelines

### Adding New Engines
1. Create interface in appropriate directory (e.g., `asr_interface.py`)
2. Implement concrete class following existing patterns
3. Add to factory class (e.g., `asr_factory.py`)
4. Update configuration classes in `config_manager/`
5. Add configuration options to default YAML files

### WebSocket Message Handling
1. Add message type to `MessageType` enum in `websocket_handler.py`
2. Create handler method following `_handle_*` pattern
3. Register in `_init_message_handlers()` dictionary
4. Ensure proper error handling and client response

### Configuration Changes
- Always update both default config templates
- Maintain backward compatibility when possible
- Use the upgrade system for breaking changes
- Validate configurations in respective config manager classes

## Testing and Quality Assurance

The project uses:
- **Ruff** for linting and formatting (configured in `pyproject.toml`)
- **Pre-commit hooks** for automated quality checks
- **GitHub Actions** for CI/CD (`.github/workflows/`)
- `unittest`-based tests in `test/` (see Tests above) plus manual testing through the web interface, desktop client, and mobile app

## Package Management

Uses **uv** (modern Python package manager):
- Dependencies defined in `pyproject.toml`
- Lock file: `uv.lock`
- Generated requirements: `requirements.txt` (auto-generated)
- Optional dependencies for specific features (e.g., `bilibili` extra)

Frontend (`frontend/`) and mobile (`mobile/`) are separate Node projects with their own `package.json`/lockfiles — `npm` for frontend, `pnpm` (via `corepack`) for mobile.
