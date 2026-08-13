from __future__ import annotations

import subprocess
import sys
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.auth import ResolvedAuth
from taku_publisher.cli import _marketplace_install_client, _run_creator_command
from taku_publisher.constants import DEFAULT_WORKER_URL


class CreatorAuthTests(unittest.TestCase):
    def _completed(self) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout='{"ok": true}', stderr="")

    def test_scan_logs_in_before_persona_generation(self) -> None:
        missing = ResolvedAuth("", "missing")
        scoped = ResolvedAuth(
            "publisher-token",
            "publisher_session",
            scopes=("creator.card.write",),
        )
        with (
            patch("taku_publisher.cli.resolve_auth", side_effect=[missing, scoped]),
            patch("taku_publisher.cli.login_with_browser") as login,
            patch("taku_publisher.cli.subprocess.run", return_value=self._completed()) as run,
        ):
            result = _run_creator_command("scan", ["--json"])

        login.assert_called_once_with(
            worker_url="https://worker.taku.ai",
            site_url="https://taku.ai",
            intent="publish_stax_card",
        )
        run.assert_called_once()
        self.assertTrue(result["ok"])

    def test_existing_scoped_session_skips_login(self) -> None:
        auth = ResolvedAuth(
            "publisher-token",
            "publisher_session",
            scopes=("creator.card.write",),
        )
        with (
            patch("taku_publisher.cli.resolve_auth", return_value=auth),
            patch("taku_publisher.cli.login_with_browser") as login,
            patch("taku_publisher.cli.subprocess.run", return_value=self._completed()),
        ):
            _run_creator_command("draft", ["--json"])

        login.assert_not_called()

    def test_existing_draft_editor_does_not_force_login(self) -> None:
        completed = subprocess.CompletedProcess([], 0)
        with (
            patch("taku_publisher.cli.resolve_auth") as resolve_auth,
            patch("taku_publisher.cli.login_with_browser") as login,
            patch("taku_publisher.cli.subprocess.run", return_value=completed),
        ):
            result = _run_creator_command("editor", ["--draft", "/tmp/card.json"])

        resolve_auth.assert_not_called()
        login.assert_not_called()
        self.assertTrue(result["_skip_emit"])

    def test_creator_center_command_requests_narrow_scopes(self) -> None:
        missing = ResolvedAuth(
            "publisher-token",
            "publisher_session",
            scopes=("publisher.drafts.write",),
        )
        scoped = ResolvedAuth(
            "creator-center-token",
            "publisher_session",
            scopes=("creator.items.read",),
        )
        with (
            patch("taku_publisher.cli.resolve_auth", side_effect=[missing, scoped]),
            patch("taku_publisher.cli.login_with_browser") as login,
            patch("taku_publisher.cli.subprocess.run", return_value=self._completed()),
        ):
            result = _run_creator_command("center-list", ["--json"])

        login.assert_called_once_with(
            worker_url="https://worker.taku.ai",
            site_url="https://taku.ai",
            intent="creator_center",
        )
        self.assertTrue(result["ok"])

    def test_creator_center_unpublish_requests_dedicated_scope(self) -> None:
        missing = ResolvedAuth(
            "creator-center-token",
            "publisher_session",
            scopes=("creator.items.read", "creator.items.write"),
        )
        scoped = ResolvedAuth(
            "creator-unpublish-token",
            "publisher_session",
            scopes=("creator.items.unpublish",),
        )
        with (
            patch("taku_publisher.cli.resolve_auth", side_effect=[missing, scoped]),
            patch("taku_publisher.cli.login_with_browser") as login,
            patch("taku_publisher.cli.subprocess.run", return_value=self._completed()),
        ):
            result = _run_creator_command("center-unpublish", ["--json", "--item-id", "item-1"])

        login.assert_called_once_with(
            worker_url="https://worker.taku.ai",
            site_url="https://taku.ai",
            intent="creator_center_unpublish",
        )
        self.assertTrue(result["ok"])

    def test_marketplace_install_requests_only_install_scopes(self) -> None:
        missing = ResolvedAuth(
            "creator-center-token",
            "publisher_session",
            scopes=("creator.items.read",),
        )
        scoped = ResolvedAuth(
            "marketplace-install-token",
            "publisher_session",
            scopes=(
                "marketplace.packages.read",
                "marketplace.installs.write",
            ),
        )
        arguments = Namespace(
            token_env="_".join(("TAKU", "BEARER", "TOKEN")),
            worker_url=DEFAULT_WORKER_URL,
            timeout=30.0,
            allow_custom_worker_url=False,
            no_browser_login=False,
            site_url="https://taku.ai",
            auth_timeout=300.0,
        )
        with (
            patch(
                "taku_publisher.cli.resolve_auth",
                side_effect=[missing, scoped],
            ),
            patch("taku_publisher.cli.login_with_browser") as login,
        ):
            client = _marketplace_install_client(arguments)

        login.assert_called_once_with(
            worker_url=DEFAULT_WORKER_URL,
            site_url="https://taku.ai",
            intent="marketplace_install",
            timeout=300.0,
        )
        self.assertEqual("marketplace-install-token", client.token)


if __name__ == "__main__":
    unittest.main()
