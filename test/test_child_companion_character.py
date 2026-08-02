import unittest
from pathlib import Path

from src.open_llm_vtuber.config_manager.utils import read_yaml


class ChildCompanionCharacterTest(unittest.TestCase):
    def test_companion_is_a_strict_english_free_chat_role(self):
        config = read_yaml(
            str(Path(__file__).parent.parent / "characters" / "en_child_companion.yaml")
        )["character_config"]

        self.assertEqual(config["teaching_session"]["mode"], "free_chat")
        self.assertEqual(config["conf_name"], "Sunny — English Conversation")
        self.assertIn("Every response must be entirely in natural English.", config["persona_prompt"])


if __name__ == "__main__":
    unittest.main()
