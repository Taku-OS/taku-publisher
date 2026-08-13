from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.auth import auth_has_scope, auth_status, resolve_auth, resolve_auth_token


class AuthResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_env = {
            "TAKU_BEARER_TOKEN": os.environ.get("TAKU_BEARER_TOKEN"),
            "TAKU_PUBLISH_TOKEN": os.environ.get("TAKU_PUBLISH_TOKEN"),
            "TAKU_SESSION_PATH": os.environ.get("TAKU_SESSION_PATH"),
            "TAKU_PUBLISHER_SESSION_PATH": os.environ.get("TAKU_PUBLISHER_SESSION_PATH"),
            "TAKU_PUBLISHER_HOME": os.environ.get("TAKU_PUBLISHER_HOME"),
            "TAKU_HOME": os.environ.get("TAKU_HOME"),
        }
        for name in self.original_env:
            os.environ.pop(name, None)
        self.publisher_home = tempfile.TemporaryDirectory()
        os.environ["TAKU_PUBLISHER_HOME"] = self.publisher_home.name

    def tearDown(self) -> None:
        for name, value in self.original_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        self.publisher_home.cleanup()

    def test_env_token_takes_priority_for_ci(self) -> None:
        os.environ["TAKU_BEARER_TOKEN"] = "env-token"
        with tempfile.TemporaryDirectory() as temporary:
            session_file = Path(temporary) / "session.json"
            session_file.write_text(
                json.dumps({"user": {"email": "wrong-session@example.com"}}),
                encoding="utf-8",
            )
            os.environ["TAKU_SESSION_PATH"] = str(session_file)
            resolved = resolve_auth()
            status = auth_status()
        self.assertEqual("env-token", resolved.token)
        self.assertEqual("env:TAKU_BEARER_TOKEN", resolved.source)
        self.assertIsNone(status["account_hint"])

    def test_scoped_env_token_is_not_reused_for_icon_generation(self) -> None:
        os.environ["TAKU_BEARER_TOKEN"] = "taku_pub_scoped"
        resolved = resolve_auth()
        self.assertEqual("taku_pub_scoped", resolved.token)
        self.assertEqual("", resolved.icon_token)

    def test_valid_desktop_session_is_used_without_env(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session_file = Path(temporary) / "session.json"
            session_file.write_text(
                json.dumps({
                    "accessToken": "session-token",
                    "refreshToken": "refresh-token",
                    "expiresAt": int(time.time() * 1000) + 60 * 60 * 1000,
                    "user": {"email": "creator@example.com", "id": "user-1"},
                }),
                encoding="utf-8",
            )
            os.environ["TAKU_SESSION_PATH"] = str(session_file)
            self.assertEqual("session-token", resolve_auth_token())
            status = auth_status()

        self.assertTrue(status["authenticated"])
        self.assertEqual("session", status["source"])
        self.assertEqual("cre***@example.com", status["account_hint"])
        self.assertTrue(status["can_refresh"])
        self.assertNotIn("token", json.dumps(status).lower())

    def test_standalone_publisher_session_precedes_desktop_session(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            publisher_session = root / "publisher-session.json"
            desktop_session = root / "desktop-session.json"
            publisher_session.write_text(
                json.dumps({
                    "accessToken": "publisher-token",
                    "expiresAt": int(time.time() * 1000) + 60 * 60 * 1000,
                    "iconToken": "icon-token",
                    "iconExpiresAt": int(time.time() * 1000) + 10 * 60 * 1000,
                    "accountHint": "cre***@example.com",
                }),
                encoding="utf-8",
            )
            desktop_session.write_text(
                json.dumps({
                    "accessToken": "desktop-token",
                    "expiresAt": int(time.time() * 1000) + 60 * 60 * 1000,
                }),
                encoding="utf-8",
            )
            os.environ["TAKU_PUBLISHER_SESSION_PATH"] = str(publisher_session)
            os.environ["TAKU_SESSION_PATH"] = str(desktop_session)

            resolved = resolve_auth()
            status = auth_status()

        self.assertEqual("publisher-token", resolved.token)
        self.assertEqual("icon-token", resolved.icon_token)
        self.assertEqual("publisher_session", resolved.source)
        self.assertEqual("cre***@example.com", status["account_hint"])

    def test_publisher_session_scopes_are_enforced_locally(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session_file = Path(temporary) / "publisher-session.json"
            session_file.write_text(
                json.dumps({
                    "accessToken": "scoped-auth",
                    "expiresAt": int(time.time() * 1000) + 60 * 60 * 1000,
                    "scopes": ["publisher.drafts.write"],
                }),
                encoding="utf-8",
            )
            os.environ["TAKU_PUBLISHER_SESSION_PATH"] = str(session_file)
            resolved = resolve_auth()

        self.assertTrue(auth_has_scope(resolved, "publisher.drafts.write"))
        self.assertFalse(auth_has_scope(resolved, "creator.card.write"))

    def test_expired_session_refreshes_without_printing_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session_file = Path(temporary) / "session.json"
            session_file.write_text(
                json.dumps({
                    "accessToken": "expired-token",
                    "refreshToken": "refresh-token",
                    "expiresAt": int(time.time() * 1000) - 1000,
                }),
                encoding="utf-8",
            )
            os.environ["TAKU_SESSION_PATH"] = str(session_file)

            def transport(url, headers, body, timeout):
                self.assertTrue(url.endswith("/auth/v1/token?grant_type=refresh_token"))
                self.assertEqual({"refresh_token": "refresh-token"}, json.loads(body.decode("utf-8")))
                self.assertNotIn("expired-token", json.dumps(headers))
                return 200, json.dumps({
                    "access_token": "fresh-token",
                    "refresh_token": "fresh-refresh",
                    "expires_in": 3600,
                }).encode("utf-8")

            resolved = resolve_auth(transport=transport)
            status = auth_status(transport=transport)
            stored = json.loads(session_file.read_text(encoding="utf-8"))

        self.assertEqual("fresh-token", resolved.token)
        self.assertTrue(resolved.refreshed)
        self.assertEqual("fresh-refresh", stored["refreshToken"])
        self.assertTrue(status["authenticated"])
        self.assertNotIn("fresh-token", json.dumps(status))


if __name__ == "__main__":
    unittest.main()
