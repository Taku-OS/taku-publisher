from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.browser_auth import login_with_browser


class BrowserAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_session_path = os.environ.get("TAKU_PUBLISHER_SESSION_PATH")

    def tearDown(self) -> None:
        if self.previous_session_path is None:
            os.environ.pop("TAKU_PUBLISHER_SESSION_PATH", None)
        else:
            os.environ["TAKU_PUBLISHER_SESSION_PATH"] = self.previous_session_path

    def test_loopback_pkce_callback_saves_scoped_publisher_session(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session_path = Path(temporary) / "session.json"
            os.environ["TAKU_PUBLISHER_SESSION_PATH"] = str(session_path)

            def browser_open(login_url: str) -> bool:
                params = urllib.parse.parse_qs(urllib.parse.urlparse(login_url).query)
                callback_url = params["return_to"][0]
                state = params["auth_state"][0]
                with urllib.request.urlopen(callback_url, timeout=2) as response:
                    self.assertEqual(200, response.status)
                request = urllib.request.Request(
                    callback_url,
                    data=json.dumps({"code": "one-time-code", "state": state}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    self.assertEqual(200, response.status)
                return True

            with patch(
                "taku_publisher.browser_auth._redeem_local_code",
                return_value={
                    "token": "publisher-token",
                    "expiresIn": 3600,
                    "scopes": ["publisher.drafts.write"],
                    "iconToken": "icon-token",
                    "iconTokenExpiresIn": 600,
                    "accountHint": "cre***@example.com",
                },
            ):
                status = login_with_browser(
                    worker_url="https://worker.example.test",
                    site_url="https://taku.example.test",
                    timeout=2,
                    browser_open=browser_open,
                )

            session = json.loads(session_path.read_text(encoding="utf-8"))

        self.assertTrue(status["authenticated"])
        self.assertEqual("publisher_session", status["source"])
        self.assertEqual("publisher-token", session["accessToken"])
        self.assertEqual("icon-token", session["iconToken"])
        self.assertEqual(["publisher.drafts.write"], session["scopes"])


if __name__ == "__main__":
    unittest.main()
