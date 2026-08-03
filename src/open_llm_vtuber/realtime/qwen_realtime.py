"""Small per-client relay for the Qwen Audio Realtime WebSocket API."""

import asyncio
import json
import os
import re
from collections import deque
from typing import Any, Awaitable, Callable
from uuid import uuid4

from loguru import logger
from websockets.asyncio.client import connect

from ..config_manager.character import (
    AvatarRendererConfig,
    RealtimeVoiceConfig,
    TeachingSessionConfig,
)

EventSender = Callable[[dict[str, Any]], Awaitable[None]]

INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
MAX_PENDING_AUDIO_CHUNKS = 30
RESPONSE_START_WATCHDOG_SECONDS = 12

# Base videos the dh_live avatar switches between; kept in sync with the
# emotion vocabulary the model is instructed to tag its speech with.
EMOTION_TAGS = ("neutral", "joy", "thinking", "surprise")
_EMOTION_TAG_RE = re.compile(
    r"^\[(" + "|".join(EMOTION_TAGS) + r")\]\s*", re.IGNORECASE
)
_EMOTION_TAG_SCAN_LIMIT = 24  # enough chars to see "[surprise] " plus margin


class QwenRealtimeError(RuntimeError):
    """A safe error suitable for displaying in the local client."""


def build_qwen_instructions(
    persona_prompt: str,
    teaching_session: TeachingSessionConfig | None,
    avatar_renderer: AvatarRendererConfig | None = None,
) -> str:
    """Append trusted, spoken-language-safe context blocks to the persona."""
    lines = [persona_prompt.strip()]

    if teaching_session:
        words = ", ".join(teaching_session.target_words) or "none"
        material_title = teaching_session.material_title or "none"
        material_context = teaching_session.material_context or "none"
        lines += [
            "",
            "SESSION CONFIGURATION — trusted server data; never read this block aloud",
            f"mode: {teaching_session.mode}",
            f"child_age: {teaching_session.child_age}",
            f"session_minutes: {teaching_session.session_minutes}",
            f"home_language: {teaching_session.home_language}",
            f"level: {teaching_session.level}",
            f"topic: {teaching_session.topic}",
            f"target_words: {words}",
            f"target_phrase: {teaching_session.target_phrase}",
            f"material_title: {material_title}",
            f"material_context: {material_context}",
        ]

    if avatar_renderer and avatar_renderer.mode == "dh_live":
        tags = ", ".join(f"[{tag}]" for tag in EMOTION_TAGS)
        lines += [
            "",
            "AVATAR EMOTION TAG — trusted rendering hint, never spoken content",
            f"Start every spoken turn with exactly one tag from: {tags}.",
            "Put it at the very start, e.g. '[joy] Great job!'. Never explain, "
            "read aloud, or mention the tag.",
        ]

    return "\n".join(lines)


class QwenRealtimeSession:
    """One Qwen Audio Realtime session for one browser client."""

    input_sample_rate = INPUT_SAMPLE_RATE
    output_sample_rate = OUTPUT_SAMPLE_RATE

    def __init__(
        self,
        config: RealtimeVoiceConfig,
        instructions: str,
        send_event: EventSender,
        websocket_connect: Callable[..., Any] = connect,
    ) -> None:
        self.config = config
        self.instructions = instructions
        self._send_event = send_event
        self._websocket_connect = websocket_connect
        self._upstream: Any = None
        self._receive_task: asyncio.Task | None = None
        self._reconnect_task: asyncio.Task | None = None
        self._watchdog_task: asyncio.Task | None = None
        self._ready = asyncio.Event()
        self._send_lock = asyncio.Lock()
        self._connect_lock = asyncio.Lock()
        self._closed = False
        self._pending_audio: deque[str] = deque(maxlen=MAX_PENDING_AUDIO_CHUNKS)
        self._turn_generation = 0
        self._turn_id = ""
        self._turn_by_item: dict[str, tuple[str, int]] = {}
        self._response_contexts: dict[str, tuple[str, int]] = {}
        self._cancelled_response_ids: deque[str] = deque(maxlen=32)
        self._expected_turn_id = ""
        self._emotion_scan_buffer: dict[str, str] = {}
        self._emotion_resolved: set[str] = set()

    @property
    def ready(self) -> bool:
        return self._ready.is_set()

    @property
    def is_closed(self) -> bool:
        return self._closed

    def _url(self) -> str:
        separator = "&" if "?" in self.config.base_url else "?"
        return f"{self.config.base_url}{separator}model={self.config.model}"

    async def connect(self) -> None:
        """Open upstream and wait until its session is configured."""
        self._closed = False
        await self._connect_once()

    async def _connect_once(self) -> None:
        api_key = os.getenv("DASHSCOPE_API_KEY")
        if not api_key:
            raise QwenRealtimeError("未设置 DASHSCOPE_API_KEY，无法启动 Qwen 实时语音。")

        async with self._connect_lock:
            if self._closed:
                return
            if self.ready:
                return
            self._ready.clear()
            try:
                self._upstream = await self._websocket_connect(
                    self._url(),
                    additional_headers={"Authorization": f"Bearer {api_key}"},
                    max_size=2 * 1024 * 1024,
                    ping_interval=20,
                    ping_timeout=20,
                )
                self._receive_task = asyncio.create_task(self._receive_loop())
                await asyncio.wait_for(self._ready.wait(), timeout=25)
            except asyncio.TimeoutError as error:
                await self._close_upstream()
                raise QwenRealtimeError("连接 Qwen 实时语音超时。") from error
            except QwenRealtimeError:
                await self._close_upstream()
                raise
            except Exception as error:
                await self._close_upstream()
                logger.warning("Unable to connect Qwen realtime: {}", type(error).__name__)
                raise QwenRealtimeError("无法连接 Qwen 实时语音，请检查网络、地域和 Key。") from error

    async def append_audio(self, audio: str) -> None:
        """Forward one Base64 PCM16 chunk or retain a tiny pre-ready buffer."""
        if self._closed:
            return
        if not self.ready:
            self._pending_audio.append(audio)
            return
        await self._send_upstream("input_audio_buffer.append", audio=audio)

    async def send_text(self, text: str) -> None:
        text = text.strip()
        if not text:
            return
        if not self.ready:
            raise QwenRealtimeError("Qwen 实时语音还没有准备好。")
        await self._send_upstream(
            "conversation.item.create",
            item={
                "id": f"item_{uuid4().hex}",
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text}],
            },
        )
        await self._send_upstream("response.create")

    async def cancel(self, reason: str = "user_interruption") -> None:
        """Cancel current model output and make late deltas harmless."""
        response_id = next(reversed(self._response_contexts), "")
        if response_id:
            self._cancelled_response_ids.append(response_id)
            await self._emit(
                {
                    "type": "response.interrupted",
                    "responseId": response_id,
                    "turnId": self._response_contexts[response_id][0],
                }
            )
        await self._emit({"type": "playback.clear", "reason": reason})
        if self.ready:
            await self._send_upstream("response.cancel")

    async def close(self) -> None:
        """Stop every task and close the upstream connection exactly once."""
        if self._closed:
            return
        self._closed = True
        self._ready.clear()
        for task in (self._watchdog_task, self._reconnect_task, self._receive_task):
            if task and task is not asyncio.current_task() and not task.done():
                task.cancel()
        await self._close_upstream()

    async def _close_upstream(self) -> None:
        upstream, self._upstream = self._upstream, None
        if upstream:
            try:
                await upstream.close()
            except Exception:
                pass

    async def _receive_loop(self) -> None:
        upstream = self._upstream
        try:
            async for raw_event in upstream:
                try:
                    event = json.loads(raw_event)
                except (TypeError, json.JSONDecodeError):
                    logger.warning("Ignored malformed Qwen realtime event")
                    continue
                await self._handle_upstream_event(event)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("Qwen realtime receive loop stopped: {}", type(error).__name__)
        finally:
            if self._upstream is upstream:
                self._upstream = None
                self._ready.clear()
            if not self._closed:
                await self._emit(
                    {
                        "type": "error",
                        "code": "qwen_connection_closed",
                        "message": "Qwen 语音连接已断开，正在恢复。",
                        "recoverable": True,
                    }
                )
                self._schedule_reconnect()

    def _schedule_reconnect(self) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            return
        self._reconnect_task = asyncio.create_task(self._reconnect())

    async def _reconnect(self) -> None:
        for delay in (0.5, 1, 2, 4, 8, 10):
            if self._closed:
                return
            await asyncio.sleep(delay)
            try:
                await self._connect_once()
                await self._emit({"type": "voice.state", "state": "idle"})
                return
            except QwenRealtimeError:
                continue
        if not self._closed:
            await self._emit(
                {
                    "type": "error",
                    "code": "qwen_reconnect_failed",
                    "message": "Qwen 语音连接恢复失败，请重新连接。",
                    "recoverable": False,
                }
            )

    async def _handle_upstream_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")
        if event_type == "session.created":
            await self._send_session_update()
            return
        if event_type == "session.updated":
            self._ready.set()
            await self._emit(
                {
                    "type": "voice.ready",
                    "inputSampleRate": INPUT_SAMPLE_RATE,
                    "outputSampleRate": OUTPUT_SAMPLE_RATE,
                }
            )
            while self._pending_audio:
                await self._send_upstream(
                    "input_audio_buffer.append", audio=self._pending_audio.popleft()
                )
            return
        if event_type == "input_audio_buffer.speech_started":
            await self._on_speech_started(event)
            return
        if event_type == "input_audio_buffer.speech_stopped":
            await self._on_speech_stopped(event)
            return
        if event_type == "input_audio_buffer.committed":
            await self._emit(
                {"type": "voice.state", "state": "thinking", "turnId": self._turn_for(event)[0]}
            )
            return
        if event_type in {
            "conversation.item.input_audio_transcription.delta",
            "conversation.item.input_audio_transcription.text",
        }:
            content = str(event.get("delta") or event.get("text") or "")
            if content:
                await self._emit(
                    {
                        "type": "transcript.delta",
                        "role": "user",
                        "content": content,
                        "turnId": self._turn_for(event)[0],
                        "replace": True,
                    }
                )
            return
        if event_type == "conversation.item.input_audio_transcription.completed":
            content = str(event.get("transcript") or "").strip()
            if content:
                await self._emit(
                    {
                        "type": "transcript.final",
                        "role": "user",
                        "content": content,
                        "turnId": self._turn_for(event)[0],
                    }
                )
            else:
                await self._emit(
                    {
                        "type": "transcript.discard",
                        "role": "user",
                        "turnId": self._turn_for(event)[0],
                        "reason": "empty_transcript",
                    }
                )
            return
        if event_type == "response.created":
            await self._on_response_created(event)
            return
        if event_type in {"response.audio.delta", "response.output_audio.delta"}:
            await self._on_audio_delta(event)
            return
        if event_type in {
            "response.audio_transcript.delta",
            "response.output_audio_transcript.delta",
        }:
            await self._on_assistant_transcript(event, final=False)
            return
        if event_type in {
            "response.audio_transcript.done",
            "response.output_audio_transcript.done",
        }:
            await self._on_assistant_transcript(event, final=True)
            return
        if event_type in {"response.audio.done", "response.output_audio.done"}:
            response_id = self._response_id(event)
            if response_id not in self._cancelled_response_ids:
                await self._emit(
                    {
                        "type": "audio.done",
                        "responseId": response_id,
                        "turnId": self._response_context(response_id)[0],
                    }
                )
            return
        if event_type == "response.done":
            await self._on_response_done(event)
            return
        if event_type == "error":
            await self._on_upstream_error(event)

    async def _send_session_update(self) -> None:
        turn_detection: dict[str, Any] = {"type": self.config.turn_detection}
        if self.config.turn_detection == "server_vad":
            turn_detection.update(
                threshold=self.config.turn_detection_threshold,
                silence_duration_ms=self.config.turn_detection_silence_ms,
            )
        await self._send_upstream(
            "session.update",
            session={
                "modalities": ["text", "audio"],
                "instructions": self.instructions,
                "voice": self.config.voice,
                "input_audio_format": "pcm",
                "output_audio_format": "pcm",
                "turn_detection": turn_detection,
            },
        )

    async def _on_speech_started(self, event: dict[str, Any]) -> None:
        self._turn_generation += 1
        self._turn_id = f"voice-{uuid4().hex[:12]}-{self._turn_generation}"
        item_id = str(event.get("item_id") or "")
        if item_id:
            self._turn_by_item[item_id] = (self._turn_id, self._turn_generation)
        self._cancel_watchdog()
        await self.cancel("user_interruption")
        await self._emit({"type": "turn.started", "turnId": self._turn_id})
        await self._emit(
            {"type": "voice.state", "state": "listening", "turnId": self._turn_id}
        )

    async def _on_speech_stopped(self, event: dict[str, Any]) -> None:
        turn_id, _ = self._turn_for(event)
        if event.get("reason") == "turn_invalid":
            await self._emit(
                {
                    "type": "transcript.discard",
                    "role": "user",
                    "turnId": turn_id,
                    "reason": "turn_invalid",
                }
            )
            await self._emit({"type": "voice.state", "state": "idle", "turnId": turn_id})
            return
        self._expected_turn_id = turn_id
        self._start_watchdog(turn_id)
        await self._emit(
            {"type": "voice.state", "state": "thinking", "turnId": turn_id}
        )

    async def _on_response_created(self, event: dict[str, Any]) -> None:
        response_id = self._response_id(event)
        context = self._turn_for(event)
        if self._expected_turn_id:
            context = (self._expected_turn_id, self._turn_generation)
        if response_id:
            self._response_contexts[response_id] = context
        self._cancel_watchdog()
        self._expected_turn_id = ""
        await self._emit(
            {
                "type": "response.started",
                "responseId": response_id,
                "turnId": context[0],
            }
        )

    async def _on_audio_delta(self, event: dict[str, Any]) -> None:
        response_id = self._response_id(event)
        if response_id in self._cancelled_response_ids:
            return
        audio = event.get("delta")
        if not isinstance(audio, str) or not audio:
            return
        turn_id, _ = self._response_context(response_id)
        await self._emit(
            {
                "type": "audio.delta",
                "audio": audio,
                "sampleRate": OUTPUT_SAMPLE_RATE,
                "responseId": response_id,
                "turnId": turn_id,
            }
        )

    async def _on_assistant_transcript(
        self, event: dict[str, Any], final: bool
    ) -> None:
        response_id = self._response_id(event)
        if response_id in self._cancelled_response_ids:
            return
        content = str(
            (event.get("transcript") if final else event.get("delta")) or ""
        )
        if not content:
            return
        content = await self._strip_emotion_tag(response_id, content, final)
        if not content:
            return
        turn_id, _ = self._response_context(response_id)
        await self._emit(
            {
                "type": "transcript.final" if final else "transcript.delta",
                "role": "assistant",
                "content": content,
                "turnId": turn_id,
                "responseId": response_id,
                **({"replace": True} if not final else {}),
            }
        )

    async def _strip_emotion_tag(
        self, response_id: str, text: str, final: bool
    ) -> str:
        """Extract a leading [tag] avatar-emotion marker and emit it once per
        response. Deltas arrive token-by-token so the tag can be split across
        chunks; buffer a few characters before giving up on finding one.
        Final transcripts are always the complete text, so they are checked
        directly (and still stripped even if a delta already emitted the tag,
        so the marker never reaches chat history)."""
        if final:
            match = _EMOTION_TAG_RE.match(text)
            if not match:
                return text
            if response_id not in self._emotion_resolved:
                self._emotion_resolved.add(response_id)
                await self._emit_emotion(response_id, match.group(1))
            return text[match.end() :]

        if response_id in self._emotion_resolved:
            return text

        buffer = self._emotion_scan_buffer.get(response_id, "") + text
        if not buffer.startswith("["):
            self._emotion_resolved.add(response_id)
            return buffer

        match = _EMOTION_TAG_RE.match(buffer)
        if match:
            self._emotion_resolved.add(response_id)
            self._emotion_scan_buffer.pop(response_id, None)
            await self._emit_emotion(response_id, match.group(1))
            return buffer[match.end() :]

        if len(buffer) >= _EMOTION_TAG_SCAN_LIMIT:
            # ponytail: an unrecognized or split-past-the-limit tag leaks its
            # literal "[...] " text into the transcript instead of being
            # cleaned up. Acceptable for a personal single-avatar project;
            # widen the buffer or add a partial-match fallback if that shows.
            self._emotion_resolved.add(response_id)
            self._emotion_scan_buffer.pop(response_id, None)
            return buffer

        self._emotion_scan_buffer[response_id] = buffer
        return ""

    async def _emit_emotion(self, response_id: str, tag: str) -> None:
        await self._emit(
            {
                "type": "avatar.emotion",
                "responseId": response_id,
                "emotion": tag.lower(),
            }
        )

    async def _on_response_done(self, event: dict[str, Any]) -> None:
        response_id = self._response_id(event)
        status = str(event.get("response", {}).get("status") or "")
        context = self._response_context(response_id)
        self._cancel_watchdog()
        if response_id in self._cancelled_response_ids or status == "cancelled":
            await self._emit(
                {
                    "type": "response.interrupted",
                    "responseId": response_id,
                    "turnId": context[0],
                }
            )
        elif status in {"failed", "incomplete"}:
            await self._emit(
                {
                    "type": "error",
                    "code": "qwen_response_failed",
                    "message": "Qwen 本轮回复没有完成，请再说一次。",
                    "recoverable": True,
                }
            )
        self._response_contexts.pop(response_id, None)
        self._emotion_scan_buffer.pop(response_id, None)
        self._emotion_resolved.discard(response_id)

    async def _on_upstream_error(self, event: dict[str, Any]) -> None:
        message = str(event.get("error", {}).get("message") or "Qwen realtime error")
        if "no active response" in message.lower():
            return
        await self._emit(
            {
                "type": "error",
                "code": "qwen_upstream_error",
                "message": "Qwen 实时语音暂时不可用，请稍后再试。",
                "recoverable": True,
            }
        )

    def _turn_for(self, event: dict[str, Any]) -> tuple[str, int]:
        item_id = str(event.get("item_id") or event.get("item", {}).get("id") or "")
        return self._turn_by_item.get(item_id, (self._turn_id, self._turn_generation))

    def _response_id(self, event: dict[str, Any]) -> str:
        return str(
            event.get("response_id")
            or event.get("response", {}).get("id")
            or event.get("item", {}).get("response_id")
            or ""
        )

    def _response_context(self, response_id: str) -> tuple[str, int]:
        return self._response_contexts.get(response_id, (self._turn_id, self._turn_generation))

    async def _send_upstream(self, event_type: str, **payload: Any) -> None:
        if not self._upstream:
            raise QwenRealtimeError("Qwen 实时语音连接不可用。")
        event = {"event_id": f"event_{uuid4().hex}", "type": event_type, **payload}
        async with self._send_lock:
            await self._upstream.send(json.dumps(event))

    async def _emit(self, event: dict[str, Any]) -> None:
        await self._send_event(event)

    def _start_watchdog(self, turn_id: str) -> None:
        self._cancel_watchdog()
        self._watchdog_task = asyncio.create_task(self._watch_response(turn_id))

    async def _watch_response(self, turn_id: str) -> None:
        try:
            await asyncio.sleep(RESPONSE_START_WATCHDOG_SECONDS)
            if self._expected_turn_id != turn_id:
                return
            self._expected_turn_id = ""
            await self._emit(
                {
                    "type": "error",
                    "code": "qwen_response_timeout",
                    "message": "Qwen 没有开始回复，请再说一次。",
                    "recoverable": True,
                }
            )
            await self._emit({"type": "voice.state", "state": "idle", "turnId": turn_id})
        except asyncio.CancelledError:
            pass

    def _cancel_watchdog(self) -> None:
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
        self._watchdog_task = None
