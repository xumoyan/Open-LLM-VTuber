import json
import unittest

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
