import asyncio
import json
import os
import unittest
from unittest import mock

from src.open_llm_vtuber.config_manager.character import (
    RealtimeVoiceConfig,
    TeachingSessionConfig,
)
from src.open_llm_vtuber.realtime.qwen_realtime import (
    QwenRealtimeSession,
    build_qwen_instructions,
)


class FakeUpstream:
    def __init__(self):
        self.sent = []
        self.closed = False

    async def send(self, event):
        self.sent.append(json.loads(event))

    async def close(self):
        self.closed = True


class QwenRealtimeSessionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.events = []
        self.upstream = FakeUpstream()

        async def collect(event):
            self.events.append(event)

        self.session = QwenRealtimeSession(
            RealtimeVoiceConfig(),
            "Speak only child-safe words.",
            collect,
        )
        self.session._upstream = self.upstream

    async def asyncTearDown(self):
        await self.session.close()

    async def test_session_setup_and_stream_mapping(self):
        await self.session._handle_upstream_event({"type": "session.created"})
        self.assertEqual(self.upstream.sent[-1]["type"], "session.update")
        self.assertEqual(
            self.upstream.sent[-1]["session"]["turn_detection"]["type"],
            "smart_turn",
        )

        await self.session._handle_upstream_event({"type": "session.updated"})
        self.assertTrue(self.session.ready)
        self.assertIn(
            {
                "type": "voice.ready",
                "inputSampleRate": 16000,
                "outputSampleRate": 24000,
            },
            self.events,
        )

        await self.session._handle_upstream_event(
            {"type": "input_audio_buffer.speech_started", "item_id": "item-user"}
        )
        turn_id = self.session._turn_id
        await self.session._handle_upstream_event(
            {"type": "input_audio_buffer.speech_stopped", "item_id": "item-user"}
        )
        await self.session._handle_upstream_event(
            {"type": "response.created", "response": {"id": "response-1"}}
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio.delta",
                "response_id": "response-1",
                "delta": "AAE=",
            }
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.done",
                "response_id": "response-1",
                "transcript": "A little cat!",
            }
        )

        self.assertIn(
            {
                "type": "audio.delta",
                "audio": "AAE=",
                "sampleRate": 24000,
                "responseId": "response-1",
                "turnId": turn_id,
            },
            self.events,
        )
        self.assertIn(
            {
                "type": "transcript.final",
                "role": "assistant",
                "content": "A little cat!",
                "turnId": turn_id,
                "responseId": "response-1",
            },
            self.events,
        )

    async def test_server_vad_is_tuned_for_short_child_answers(self):
        self.session.config = RealtimeVoiceConfig(
            turn_detection="server_vad",
            turn_detection_threshold=0.25,
            turn_detection_silence_ms=450,
        )

        await self.session._send_session_update()

        self.assertEqual(
            self.upstream.sent[-1]["session"]["turn_detection"],
            {
                "type": "server_vad",
                "threshold": 0.25,
                "silence_duration_ms": 450,
            },
        )

    async def test_voiceprint_url_is_sent_on_first_session_update_in_smart_turn(self):
        self.session.voiceprint_url = "https://example.com/voiceprints/device-1.wav"

        await self.session._send_session_update()

        self.assertEqual(
            self.upstream.sent[-1]["session"]["turn_detection"],
            {
                "type": "smart_turn",
                "voiceprint_audio_urls": ["https://example.com/voiceprints/device-1.wav"],
            },
        )

    async def test_no_voiceprint_field_when_url_not_set(self):
        await self.session._send_session_update()

        self.assertNotIn(
            "voiceprint_audio_urls", self.upstream.sent[-1]["session"]["turn_detection"]
        )

    async def test_voiceprint_registration_events_forwarded_to_client(self):
        await self.session._handle_upstream_event(
            {"type": "voiceprint_audio_list.failed", "reason": "url_unreachable"}
        )

        self.assertIn(
            {"type": "voiceprint.status", "state": "failed", "reason": "url_unreachable"},
            self.events,
        )

    async def test_final_transcripts_are_translated_for_display(self):
        async def fake_translate(text):
            return f"[zh] {text}"

        self.session._translate = fake_translate

        await self.session._handle_upstream_event(
            {"type": "input_audio_buffer.speech_started", "item_id": "item-user"}
        )
        await self.session._handle_upstream_event(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "item-user",
                "transcript": "I like cats",
            }
        )
        await self.session._handle_upstream_event(
            {"type": "response.created", "response": {"id": "response-1"}}
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.done",
                "response_id": "response-1",
                "transcript": "Cats say meow!",
            }
        )
        await asyncio.gather(*self.session._background_tasks)

        translations = [e for e in self.events if e["type"] == "transcript.translation"]
        self.assertEqual(
            {(t["role"], t["content"]) for t in translations},
            {
                ("user", "[zh] I like cats"),
                ("assistant", "[zh] Cats say meow!"),
            },
        )

    async def test_translation_is_skipped_without_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            result = await self.session._translate("hello")
        self.assertEqual(result, "")

    async def test_stalled_turn_recovers_when_no_response_ever_starts(self):
        with mock.patch(
            "src.open_llm_vtuber.realtime.qwen_realtime.TURN_STALL_WATCHDOG_SECONDS",
            0.01,
        ):
            await self.session._handle_upstream_event(
                {"type": "input_audio_buffer.speech_started", "item_id": "item-a"}
            )
            await self.session._stall_watchdog_task

        self.assertIn(
            {
                "type": "error",
                "code": "qwen_turn_stalled",
                "message": "听了一会儿没反应过来，麦克风重新开始听吧。",
                "recoverable": True,
            },
            self.events,
        )

    async def test_stall_watchdog_is_cancelled_once_a_response_starts(self):
        with mock.patch(
            "src.open_llm_vtuber.realtime.qwen_realtime.TURN_STALL_WATCHDOG_SECONDS",
            0.05,
        ):
            await self.session._handle_upstream_event(
                {"type": "input_audio_buffer.speech_started", "item_id": "item-a"}
            )
            await self.session._handle_upstream_event(
                {"type": "input_audio_buffer.speech_stopped", "item_id": "item-a"}
            )
            await self.session._handle_upstream_event(
                {"type": "response.created", "response": {"id": "response-1"}}
            )
            await asyncio.sleep(0.08)

        self.assertFalse(
            any(e.get("code") == "qwen_turn_stalled" for e in self.events)
        )

    async def test_cancelled_response_never_forwards_late_audio(self):
        self.session._ready.set()
        self.session._response_contexts["response-1"] = ("turn-1", 1)
        await self.session.cancel()
        event_count = len(self.events)
        await self.session._handle_upstream_event(
            {
                "type": "response.audio.delta",
                "response_id": "response-1",
                "delta": "AAE=",
            }
        )
        self.assertEqual(event_count, len(self.events))
        self.assertEqual(self.upstream.sent[-1]["type"], "response.cancel")


class PromptTest(unittest.TestCase):
    def test_trusted_teaching_data_is_appended_to_persona(self):
        instructions = build_qwen_instructions(
            "Be kind.",
            TeachingSessionConfig(target_words=["cat", "dog"], topic="Animals"),
        )
        self.assertIn("Be kind.", instructions)
        self.assertIn("trusted server data", instructions)
        self.assertIn("target_words: cat, dog", instructions)


if __name__ == "__main__":
    unittest.main()
