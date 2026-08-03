# config_manager/character.py
import re
from pydantic import Field, field_validator
from typing import Dict, ClassVar, Literal
from .i18n import I18nMixin, Description
from .asr import ASRConfig
from .tts import TTSConfig
from .vad import VADConfig
from .tts_preprocessor import TTSPreprocessorConfig

from .agent import AgentConfig


class RealtimeVoiceConfig(I18nMixin):
    """Configuration for the Qwen audio-to-audio realtime path."""

    enabled: bool = Field(default=False, alias="enabled")
    provider: Literal["qwen"] = Field(default="qwen", alias="provider")
    model: str = Field(
        default="qwen-audio-3.0-realtime-flash", alias="model", min_length=1
    )
    voice: str = Field(default="longanqian", alias="voice", min_length=1)
    base_url: str = Field(
        default="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        alias="base_url",
        min_length=1,
    )
    turn_detection: Literal["smart_turn", "server_vad"] = Field(
        default="smart_turn", alias="turn_detection"
    )
    turn_detection_threshold: float = Field(
        default=0.25, ge=-1.0, le=1.0, alias="turn_detection_threshold"
    )
    turn_detection_silence_ms: int = Field(
        default=450, ge=200, le=6000, alias="turn_detection_silence_ms"
    )

    @field_validator("base_url")
    @classmethod
    def check_base_url(cls, value: str) -> str:
        value = value.rstrip("/")
        if not value.startswith("wss://"):
            raise ValueError("realtime_voice.base_url must start with wss://")
        return value


class TeachingSessionConfig(I18nMixin):
    """Trusted, server-owned context appended to the teacher prompt."""

    mode: Literal["free_chat", "topic", "book"] = Field(default="topic")
    child_age: str = Field(default="3-6", max_length=20)
    home_language: str = Field(default="Chinese", max_length=40)
    level: str = Field(default="pre-A1 beginner", max_length=60)
    session_minutes: int = Field(default=10, ge=1, le=30)
    topic: str = Field(default="My little animal friends", max_length=160)
    target_words: list[str] = Field(default_factory=lambda: ["cat", "dog", "duck"], max_length=6)
    target_phrase: str = Field(default="It's a ___.", max_length=160)
    material_title: str = Field(default="", max_length=160)
    material_context: str = Field(default="", max_length=1600)

    @field_validator("target_words")
    @classmethod
    def check_target_words(cls, words: list[str]) -> list[str]:
        cleaned = [word.strip() for word in words if word.strip()]
        if len(cleaned) > 6:
            raise ValueError("teaching_session.target_words supports at most 6 words")
        return cleaned


class AvatarRendererConfig(I18nMixin):
    """Which avatar renderer the client should use; server never renders it."""

    mode: Literal["live2d", "dh_live"] = Field(default="live2d", alias="mode")
    asset_id: str = Field(default="", alias="asset_id", max_length=64)

    @field_validator("asset_id")
    @classmethod
    def check_asset_id(cls, value: str) -> str:
        value = value.strip()
        if value and not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError(
                "avatar_renderer.asset_id must only contain letters, digits, '_' or '-'"
            )
        return value


class CharacterConfig(I18nMixin):
    """Character configuration settings."""

    conf_name: str = Field(..., alias="conf_name")
    conf_uid: str = Field(..., alias="conf_uid")
    live2d_model_name: str = Field(..., alias="live2d_model_name")
    character_name: str = Field(default="", alias="character_name")
    human_name: str = Field(default="Human", alias="human_name")
    avatar: str = Field(default="", alias="avatar")
    persona_prompt: str = Field(..., alias="persona_prompt")
    agent_config: AgentConfig = Field(..., alias="agent_config")
    asr_config: ASRConfig = Field(..., alias="asr_config")
    tts_config: TTSConfig = Field(..., alias="tts_config")
    vad_config: VADConfig = Field(..., alias="vad_config")
    tts_preprocessor_config: TTSPreprocessorConfig = Field(
        ..., alias="tts_preprocessor_config"
    )
    realtime_voice: RealtimeVoiceConfig | None = Field(
        default=None, alias="realtime_voice"
    )
    teaching_session: TeachingSessionConfig | None = Field(
        default=None, alias="teaching_session"
    )
    avatar_renderer: AvatarRendererConfig = Field(
        default_factory=AvatarRendererConfig, alias="avatar_renderer"
    )

    DESCRIPTIONS: ClassVar[Dict[str, Description]] = {
        "conf_name": Description(
            en="Name of the character configuration", zh="角色配置名称"
        ),
        "conf_uid": Description(
            en="Unique identifier for the character configuration",
            zh="角色配置唯一标识符",
        ),
        "live2d_model_name": Description(
            en="Name of the Live2D model to use", zh="使用的Live2D模型名称"
        ),
        "character_name": Description(
            en="Name of the AI character in conversation", zh="对话中AI角色的名字"
        ),
        "persona_prompt": Description(
            en="Persona prompt. The persona of your character.", zh="角色人设提示词"
        ),
        "agent_config": Description(
            en="Configuration for the conversation agent", zh="对话代理配置"
        ),
        "asr_config": Description(
            en="Configuration for Automatic Speech Recognition", zh="语音识别配置"
        ),
        "tts_config": Description(
            en="Configuration for Text-to-Speech", zh="语音合成配置"
        ),
        "vad_config": Description(
            en="Configuration for Voice Activity Detection", zh="语音活动检测配置"
        ),
        "tts_preprocessor_config": Description(
            en="Configuration for Text-to-Speech Preprocessor",
            zh="语音合成预处理器配置",
        ),
        "human_name": Description(
            en="Name of the human user in conversation", zh="对话中人类用户的名字"
        ),
        "avatar": Description(
            en="Avatar image path for the character", zh="角色头像图片路径"
        ),
        "realtime_voice": Description(
            en="Qwen realtime voice configuration", zh="Qwen 实时语音配置"
        ),
        "teaching_session": Description(
            en="Trusted child English teaching context", zh="可信儿童英语课程上下文"
        ),
        "avatar_renderer": Description(
            en="Client-side avatar renderer choice (live2d or dh_live)",
            zh="客户端头像渲染方式（live2d 或 dh_live）",
        ),
    }

    @field_validator("persona_prompt")
    def check_default_persona_prompt(cls, v):
        if not v:
            raise ValueError(
                "Persona_prompt cannot be empty. Please provide a persona prompt."
            )
        return v

    @field_validator("character_name")
    def set_default_character_name(cls, v, values):
        if not v and "conf_name" in values:
            return values["conf_name"]
        return v
