import json
import unittest

from src.open_llm_vtuber.config_manager.character import (
    AvatarRendererConfig,
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

    async def test_emotion_tag_split_across_deltas_is_stripped_and_emitted(self):
        await self.session._handle_upstream_event(
            {"type": "response.created", "response": {"id": "response-1"}}
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.delta",
                "response_id": "response-1",
                "delta": "[jo",
            }
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.delta",
                "response_id": "response-1",
                "delta": "y] Great ",
            }
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.delta",
                "response_id": "response-1",
                "delta": "job!",
            }
        )

        self.assertIn(
            {"type": "avatar.emotion", "responseId": "response-1", "emotion": "joy"},
            self.events,
        )
        deltas = [
            event["content"]
            for event in self.events
            if event.get("type") == "transcript.delta"
        ]
        self.assertEqual(deltas, ["Great ", "job!"])

    async def test_emotion_tag_absent_passes_content_through_untouched(self):
        await self.session._handle_upstream_event(
            {"type": "response.created", "response": {"id": "response-1"}}
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.delta",
                "response_id": "response-1",
                "delta": "No tag here.",
            }
        )

        self.assertNotIn(
            "avatar.emotion", [event["type"] for event in self.events]
        )
        self.assertIn(
            {
                "type": "transcript.delta",
                "role": "assistant",
                "content": "No tag here.",
                "turnId": self.session._turn_id,
                "responseId": "response-1",
                "replace": True,
            },
            self.events,
        )

    async def test_final_transcript_strips_tag_without_duplicate_emission(self):
        await self.session._handle_upstream_event(
            {"type": "response.created", "response": {"id": "response-1"}}
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.delta",
                "response_id": "response-1",
                "delta": "[surprise] Whoa!",
            }
        )
        await self.session._handle_upstream_event(
            {
                "type": "response.audio_transcript.done",
                "response_id": "response-1",
                "transcript": "[surprise] Whoa!",
            }
        )

        emotion_events = [e for e in self.events if e["type"] == "avatar.emotion"]
        self.assertEqual(len(emotion_events), 1)
        final_events = [e for e in self.events if e["type"] == "transcript.final"]
        self.assertEqual(final_events[0]["content"], "Whoa!")


class PromptTest(unittest.TestCase):
    def test_trusted_teaching_data_is_appended_to_persona(self):
        instructions = build_qwen_instructions(
            "Be kind.",
            TeachingSessionConfig(target_words=["cat", "dog"], topic="Animals"),
        )
        self.assertIn("Be kind.", instructions)
        self.assertIn("trusted server data", instructions)
        self.assertIn("target_words: cat, dog", instructions)

    def test_dh_live_avatar_adds_emotion_tag_instruction(self):
        instructions = build_qwen_instructions(
            "Be kind.", None, AvatarRendererConfig(mode="dh_live")
        )
        self.assertIn("[joy]", instructions)
        self.assertIn("AVATAR EMOTION TAG", instructions)

    def test_live2d_avatar_has_no_emotion_tag_instruction(self):
        instructions = build_qwen_instructions(
            "Be kind.", None, AvatarRendererConfig(mode="live2d")
        )
        self.assertNotIn("AVATAR EMOTION TAG", instructions)


if __name__ == "__main__":
    unittest.main()
