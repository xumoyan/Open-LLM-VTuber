import unittest

from src.open_llm_vtuber.routes import is_valid_mobile_access_token


class MobileAccessTokenTest(unittest.TestCase):
    def test_only_an_auth_message_with_the_expected_token_is_accepted(self):
        expected = "test-token"
        self.assertTrue(
            is_valid_mobile_access_token({"type": "auth", "token": expected}, expected)
        )
        self.assertFalse(
            is_valid_mobile_access_token({"type": "auth", "token": "wrong"}, expected)
        )
        self.assertFalse(
            is_valid_mobile_access_token({"type": "connect", "token": expected}, expected)
        )
        self.assertFalse(is_valid_mobile_access_token({"type": "auth"}, expected))
        self.assertFalse(is_valid_mobile_access_token({"type": "auth", "token": expected}, None))


if __name__ == "__main__":
    unittest.main()
