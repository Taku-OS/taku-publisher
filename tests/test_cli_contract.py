from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.cli import extract_asset_identity, main
from taku_publisher.util import atomic_write_json, read_json, set_tree_writable


class CliContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.previous_home = os.environ.get("TAKU_PUBLISHER_HOME")
        os.environ["TAKU_PUBLISHER_HOME"] = str(self.root / "publisher-home")
        self.skill = self.root / "workspace" / "skill"
        self.skill.mkdir(parents=True)
        (self.skill / "SKILL.md").write_text("# CLI Test\n", encoding="utf-8")

    def tearDown(self) -> None:
        set_tree_writable(self.root)
        if self.previous_home is None:
            os.environ.pop("TAKU_PUBLISHER_HOME", None)
        else:
            os.environ["TAKU_PUBLISHER_HOME"] = self.previous_home
        self.temporary.cleanup()

    def _run(self, arguments):
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(arguments)
        return exit_code, json.loads(output.getvalue())

    def test_discovery_pause_is_successful_structured_action(self) -> None:
        exit_code, payload = self._run(["discover", "--workspace", str(self.skill.parent)])
        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["requires_action"])
        self.assertEqual("select_one_publish_unit", payload["action_type"])
        self.assertEqual("needs_selection", payload["status"])
        self.assertEqual(["skill"], payload["allowed_types"])
        self.assertEqual(["action", "agent", "plugin"], payload["unavailable_types"])

    def test_unopened_publish_type_is_structured_error(self) -> None:
        action = self.skill.parent / "actions" / "deploy.md"
        action.parent.mkdir()
        action.write_text("# Deploy\n", encoding="utf-8")
        exit_code, payload = self._run([
            "init",
            "--workspace",
            str(self.skill.parent),
            "--source",
            str(action),
            "--type",
            "action",
            "--mode",
            "create",
        ])
        self.assertEqual(1, exit_code)
        self.assertFalse(payload["ok"])
        self.assertEqual("publish_type_not_available", payload["error"]["code"])

    def test_legacy_unopened_draft_is_read_only(self) -> None:
        draft_id = "legacy_agent"
        draft_directory = Path(os.environ["TAKU_PUBLISHER_HOME"]) / draft_id
        draft_directory.mkdir(parents=True)
        atomic_write_json(draft_directory / "state.json", {
            "draft_id": draft_id,
            "status": "selected",
            "mode": "create",
            "unit": {"type": "agent", "name": "Legacy Agent"},
        })

        status_code, status_payload = self._run(["status", "--draft-id", draft_id])
        self.assertEqual(0, status_code)
        self.assertEqual("agent", status_payload["unit"]["type"])

        stage_code, stage_payload = self._run(["stage", "--draft-id", draft_id])
        self.assertEqual(1, stage_code)
        self.assertEqual("publish_type_not_available", stage_payload["error"]["code"])

    def test_update_without_item_id_is_structured_error(self) -> None:
        exit_code, payload = self._run([
            "init",
            "--workspace",
            str(self.skill.parent),
            "--source",
            str(self.skill),
            "--type",
            "skill",
            "--mode",
            "update",
        ])
        self.assertEqual(1, exit_code)
        self.assertFalse(payload["ok"])
        self.assertEqual("missing_item_id", payload["error"]["code"])

    def test_asset_identity_is_read_only_from_worker_response(self) -> None:
        identity = {
            "schemaVersion": "taku.asset.identity.v1",
            "resourceKind": "skill",
            "resourceId": "server-skill-1",
            "localResourceId": "local-skill-1",
            "serverResourceId": "server-skill-1",
            "origin": "created",
            "visibility": "published",
            "listingId": "listing-1",
        }

        self.assertEqual(
            identity,
            extract_asset_identity({"draft": {"assetIdentity": identity}}),
        )
        self.assertIsNone(
            extract_asset_identity({"draft": {"name": "same display name"}}),
        )

    def test_creator_doctor_uses_bundled_runtime(self) -> None:
        exit_code, payload = self._run(["creator-doctor", "--json"])
        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        self.assertEqual("taku_creator", payload["name"])
        self.assertIn("draft", payload["commands"])

    def test_creator_arguments_preserve_original_order(self) -> None:
        arguments = [
            "creator-center-list",
            "--json",
            "--type",
            "skill",
            "--status",
            "draft",
            "--search",
            "weekly test",
            "--limit",
            "10",
            "--worker-url",
            "https://worker.example.test",
        ]
        with patch("taku_publisher.cli._dispatch", return_value={"ok": True}) as dispatch:
            exit_code, payload = self._run(arguments)

        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        parsed = dispatch.call_args.args[0]
        self.assertEqual(arguments[1:], parsed.creator_args)

    def test_creator_update_preserves_item_id_flag_and_value(self) -> None:
        arguments = [
            "creator-center-update",
            "--json",
            "--item-id",
            "item-123",
            "--short-description",
            "Updated description",
        ]
        with patch("taku_publisher.cli._dispatch", return_value={"ok": True}) as dispatch:
            exit_code, payload = self._run(arguments)

        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        parsed = dispatch.call_args.args[0]
        self.assertEqual(arguments[1:], parsed.creator_args)

    def test_creator_unpublish_preserves_exact_confirmation_flags(self) -> None:
        arguments = [
            "creator-center-unpublish",
            "--json",
            "--item-id",
            "item-123",
            "--confirm-item-id",
            "item-123",
        ]
        with patch("taku_publisher.cli._dispatch", return_value={"ok": True}) as dispatch:
            exit_code, payload = self._run(arguments)

        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        parsed = dispatch.call_args.args[0]
        self.assertEqual(arguments[1:], parsed.creator_args)

    def test_marketplace_search_returns_compact_public_results(self) -> None:
        class FakeClient:
            def search_marketplace(self, **kwargs):
                self.search = kwargs
                return {
                    "items": [
                        {
                            "id": "11111111-1111-4111-8111-111111111111",
                            "name": "Weekly App",
                            "slug": "weekly-app",
                            "type": "app",
                            "status": "published",
                            "displayKind": "app",
                            "installOffer": {
                                "displayKind": "app",
                                "installability": "installable",
                                "cta": "open-in-taku",
                                "deepLink": "taku://apps/weekly-app",
                            },
                            "metadata": {"private": "must-not-leak"},
                        }
                    ],
                    "nextCursor": "5",
                }

        fake_client = FakeClient()
        with patch(
            "taku_publisher.cli._marketplace_public_client",
            return_value=fake_client,
        ):
            exit_code, payload = self._run([
                "marketplace-search",
                "--json",
                "--search",
                "weekly",
                "--limit",
                "5",
            ])

        self.assertEqual(0, exit_code)
        self.assertEqual("marketplace_results", payload["status"])
        self.assertEqual("select_one_marketplace_item", payload["action_type"])
        self.assertEqual("Weekly App", payload["items"][0]["name"])
        self.assertEqual("app", payload["items"][0]["display_kind"])
        self.assertFalse(payload["items"][0]["codex_install_supported"])
        self.assertTrue(payload["items"][0]["taku_desktop_open_supported"])
        self.assertEqual(
            "open_in_taku_desktop",
            payload["items"][0]["recommended_action"],
        )
        self.assertNotIn("deep_link", payload["items"][0])
        self.assertNotIn("metadata", payload["items"][0])
        self.assertEqual("weekly", fake_client.search["search"])
        self.assertEqual("all", fake_client.search["item_kind"])
        self.assertEqual(5, fake_client.search["limit"])
        self.assertEqual("5", payload["next_cursor"])

    def test_marketplace_install_preflight_requires_exact_second_command(self) -> None:
        class FakeClient:
            def get_marketplace_install_package(self, item_id):
                self.item_id = item_id
                return {
                    "data": {
                        "item": {
                            "id": item_id,
                            "name": "Community Skill",
                            "slug": "community-skill",
                            "type": "skill",
                            "status": "published",
                        },
                        "access": {"allowed": True},
                        "latestVersion": {"versionNumber": 1},
                        "package": {
                            "versionNumber": 1,
                            "contentHash": "a" * 64,
                            "fileSizeBytes": 100,
                        },
                        "downloadUrl": "https://cdn.example.test/skill.zip",
                    }
                }

            def download_public_package(self, *args, **kwargs):
                raise AssertionError("preflight must not download the package")

        fake_client = FakeClient()
        with (
            patch(
                "taku_publisher.cli._marketplace_install_client",
                return_value=fake_client,
            ),
            patch(
                "taku_publisher.cli._codex_skills_root",
                return_value=self.root / "codex-skills",
            ),
        ):
            exit_code, payload = self._run([
                "marketplace-install",
                "--json",
                "--item-id",
                "11111111-1111-4111-8111-111111111111",
            ])

        self.assertEqual(0, exit_code)
        self.assertEqual("confirmation_required", payload["status"])
        self.assertEqual("confirm_marketplace_install", payload["action_type"])
        self.assertEqual(
            "11111111-1111-4111-8111-111111111111",
            payload["item"]["item_id"],
        )
        self.assertFalse((self.root / "codex-skills").exists())

    def test_remote_create_with_generated_icon_points_to_same_turn_upload(self) -> None:
        _, init_payload = self._run([
            "init",
            "--workspace",
            str(self.skill.parent),
            "--source",
            str(self.skill),
            "--type",
            "skill",
            "--mode",
            "create",
            "--draft-id",
            "draft-test",
        ])

        class FakeClient:
            def generate_listing_icon(self, payload):
                return {"imageUrl": "https://cdn.example.test/icon.png"}

            def create_draft(self, payload):
                return {
                    "id": "remote-draft-1",
                    "reviewUrl": "https://taku.example.test/publisher/remote-draft-1",
                }

        with patch("taku_publisher.cli._client", return_value=FakeClient()):
            exit_code, payload = self._run(["remote-create", "--draft-id", init_payload["draft_id"]])

        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["requires_action"])
        self.assertEqual("continue_local_scan_and_upload", payload["action_type"])
        self.assertEqual("continue_local_scan_package_and_upload", payload["next_step"])
        self.assertIn("remote-upload", payload["next_commands"])

    def test_update_remote_create_preserves_server_listing_and_skips_icon_generation(self) -> None:
        _, init_payload = self._run([
            "init",
            "--workspace",
            str(self.skill.parent),
            "--source",
            str(self.skill),
            "--type",
            "skill",
            "--mode",
            "update",
            "--item-id",
            "11111111-1111-4111-8111-111111111111",
            "--draft-id",
            "draft-update",
        ])

        class FakeClient:
            def __init__(self):
                self.created_payload = None

            def generate_listing_icon(self, payload):
                raise AssertionError("update drafts must inherit the existing icon")

            def create_draft(self, payload):
                self.created_payload = payload
                return {
                    "id": "remote-draft-update",
                    "reviewUrl": "https://taku.example.test/publisher/remote-draft-update",
                }

        fake_client = FakeClient()
        with patch("taku_publisher.cli._client", return_value=fake_client):
            exit_code, payload = self._run([
                "remote-create",
                "--draft-id",
                init_payload["draft_id"],
            ])

        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        self.assertEqual({}, fake_client.created_payload["listing"])
        self.assertTrue(fake_client.created_payload["inheritListing"])
        self.assertEqual(
            "11111111-1111-4111-8111-111111111111",
            fake_client.created_payload["itemId"],
        )

    def test_remote_create_uploads_when_local_package_is_ready(self) -> None:
        _, init_payload = self._run([
            "init",
            "--workspace",
            str(self.skill.parent),
            "--source",
            str(self.skill),
            "--type",
            "skill",
            "--mode",
            "create",
            "--draft-id",
            "draft-ready",
        ])
        draft_id = init_payload["draft_id"]
        self.assertEqual(0, self._run(["stage", "--draft-id", draft_id])[0])
        _, scan_payload = self._run(["scan", "--draft-id", draft_id])
        template = read_json(Path(scan_payload["dispositions_template_path"]))
        template["full_review_completed"] = True
        dispositions_path = self.root / "reviewed.json"
        atomic_write_json(dispositions_path, template)
        self.assertEqual(0, self._run([
            "apply-review",
            "--draft-id",
            draft_id,
            "--dispositions",
            str(dispositions_path),
        ])[0])
        self.assertEqual(0, self._run(["package", "--draft-id", draft_id])[0])

        class FakeClient:
            def __init__(self):
                self.uploaded = False
                self.listing = None
                self.draft_ids = []
                self.web_listing_applied = False

            def generate_listing_icon(self, payload):
                return {"imageUrl": "https://cdn.example.test/icon.png"}

            def create_draft(self, payload):
                self.listing = payload["listing"]
                return {
                    "id": "remote-draft-ready",
                    "reviewUrl": "https://taku.example.test/publisher/remote-draft-ready",
                }

            def submit_scan_report(self, draft_id, payload):
                self.draft_ids.append(draft_id)
                return {"draftId": draft_id, "status": "local_scan_passed"}

            def get_draft(self, draft_id):
                self.draft_ids.append(draft_id)
                if not self.web_listing_applied:
                    self.listing = {
                        **self.listing,
                        "description": "Description edited on Taku Web.",
                        "iconUrl": "https://cdn.example.test/web-icon.png",
                    }
                    self.web_listing_applied = True
                return {
                    "draft": {
                        "id": draft_id,
                        "listing": self.listing,
                        "reviewUrl": f"https://taku.example.test/publish/{draft_id}",
                    }
                }

            def update_draft(self, draft_id, payload):
                self.draft_ids.append(draft_id)
                self.listing = payload["listing"]
                return {"draft": {"id": draft_id, "listing": self.listing}}

            def presign_artifact(self, draft_id, *, size, sha256):
                self.draft_ids.append(draft_id)
                return {
                    "artifactId": "artifact-ready",
                    "uploadUrl": "https://uploads.example.test/bundle.zip",
                    "headers": {"x-upload": "ok"},
                }

            def upload_signed(self, upload_url, bundle_path, headers=None):
                self.uploaded = bundle_path.is_file() and headers == {"x-upload": "ok"}

            def complete_artifact(self, draft_id, artifact_id, *, size, sha256):
                self.draft_ids.append(draft_id)
                if not self.uploaded:
                    raise AssertionError("bundle was not uploaded")
                return {
                    "draftId": draft_id,
                    "artifactId": artifact_id,
                    "reviewUrl": "https://taku.example.test/publish/remote-draft-ready",
                }

        fake_client = FakeClient()
        with patch("taku_publisher.cli._client", return_value=fake_client):
            exit_code, payload = self._run(["remote-create", "--draft-id", draft_id])

        self.assertEqual(0, exit_code)
        self.assertTrue(payload["ok"])
        self.assertEqual("awaiting_web_confirmation", payload["status"])
        self.assertTrue(payload["requires_action"])
        self.assertEqual("review_and_submit_on_taku_web", payload["action_type"])
        self.assertEqual("artifact-ready", payload["artifact_id"])
        self.assertEqual("https://taku.example.test/publish/remote-draft-ready", payload["review_url"])
        self.assertTrue(fake_client.draft_ids)
        self.assertEqual({"remote-draft-ready"}, set(fake_client.draft_ids))
        saved_state = read_json(Path(os.environ["TAKU_PUBLISHER_HOME"]) / draft_id / "state.json")
        self.assertEqual("https://cdn.example.test/web-icon.png", saved_state["listing"]["iconUrl"])
        self.assertEqual("Description edited on Taku Web.", saved_state["listing"]["description"])


if __name__ == "__main__":
    unittest.main()
