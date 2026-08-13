from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.api import (
    TakuPublisherClient,
    draft_create_payload,
    extract_remote_id,
    normalize_listing_metadata,
    response_candidates,
)
from taku_publisher.util import PublisherError


class RecordingTransport:
    def __init__(self) -> None:
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append({"method": method, "url": url, "headers": dict(headers), "body": body, "timeout": timeout})
        if method == "PUT":
            return 200, {}, b""
        if url.endswith("/artifacts/presign"):
            return 200, {}, json.dumps({"artifactId": "artifact_1", "uploadUrl": "https://uploads.example.test/object"}).encode()
        return 200, {}, json.dumps({"id": "draft_1", "ok": True}).encode()


class ApiClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.transport = RecordingTransport()
        self.test_token = "user-" + "token-" + "value"
        self.client = TakuPublisherClient(
            worker_url="https://worker.example.test",
            token=self.test_token,
            allow_custom_worker_url=True,
            transport=self.transport,
        )

    def test_all_publisher_endpoints_and_signed_put_boundary(self) -> None:
        self.client.create_draft({"mode": "create"})
        self.client.get_draft("draft_1")
        self.client.update_draft("draft_1", {"title": "Safe title"})
        self.client.submit_scan_report("draft_1", {"summary": {}})
        presigned = self.client.presign_artifact("draft_1", size=3, sha256="a" * 64)
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary) / "bundle.zip"
            bundle.write_bytes(b"zip")
            self.client.upload_signed(presigned["uploadUrl"], bundle)
        self.client.complete_artifact("draft_1", "artifact_1", size=3, sha256="a" * 64)
        self.client.submit_draft("draft_1")
        self.client.get_status("draft_1")

        api_calls = [call for call in self.transport.calls if "worker.example.test" in call["url"]]
        self.assertTrue(all(call["headers"].get("Authorization") == "Bearer " + self.test_token for call in api_calls))
        upload_call = next(call for call in self.transport.calls if call["method"] == "PUT")
        self.assertNotIn("Authorization", upload_call["headers"])
        self.assertEqual("application/zip", upload_call["headers"]["Content-Type"])
        paths = [call["url"].split("worker.example.test", 1)[-1] for call in api_calls]
        self.assertIn("/stax/publisher/drafts", paths)
        self.assertIn("/stax/publisher/drafts/draft_1/artifacts/presign", paths)
        self.assertIn("/stax/publisher/drafts/draft_1/artifacts/artifact_1/complete", paths)
        self.assertIn("/stax/publisher/drafts/draft_1/submit", paths)
        self.assertIn("/stax/publisher/drafts/draft_1/status", paths)

    def test_custom_worker_requires_explicit_opt_in(self) -> None:
        with self.assertRaisesRegex(PublisherError, "explicit opt-in"):
            TakuPublisherClient(worker_url="https://worker.example.test", token="token")

    def test_missing_auth_never_falls_through_to_network(self) -> None:
        client = TakuPublisherClient(
            worker_url="https://worker.example.test",
            token="",
            allow_custom_worker_url=True,
            transport=self.transport,
        )
        with self.assertRaisesRegex(PublisherError, "do not paste"):
            client.get_draft("draft_1")
        self.assertEqual([], self.transport.calls)

    def test_nested_worker_responses_are_supported(self) -> None:
        response = {
            "draft": {"id": "draft_nested", "reviewUrl": "https://taku.ai/publish/draft_nested"},
            "artifact": {"id": "artifact_nested"},
            "upload": {
                "uploadUrl": "https://uploads.example.test/object",
                "headers": {"x-upsert": "false"},
            },
        }
        self.assertEqual("artifact_nested", extract_remote_id(response, "artifactId", "id"))
        candidates = response_candidates(response)
        self.assertTrue(any(candidate.get("reviewUrl") for candidate in candidates))
        self.assertTrue(any(candidate.get("uploadUrl") for candidate in candidates))

    def test_create_payload_uses_canonical_worker_fields(self) -> None:
        payload = draft_create_payload({
            "mode": "create",
            "unit": {
                "id": "skill-demo",
                "type": "skill",
                "name": "Demo Skill",
                "description": "A useful local skill.",
                "children": [],
            },
        })
        self.assertEqual("skill", payload["toolType"])
        self.assertEqual("Demo Skill", payload["listing"]["title"])
        self.assertEqual("local_upload", payload["listing"]["sourceKind"])
        self.assertEqual("original", payload["listing"]["authorshipKind"])
        self.assertEqual("self_owned", payload["listing"]["rightsBasis"])
        self.assertNotIn("iconUrl", payload["listing"])
        self.assertIn("Capabilities", payload["listing"]["description"])
        self.assertEqual(["writing-content"], payload["listing"]["categories"])
        self.assertEqual(["taku", "codex", "claude-code"], payload["listing"]["platforms"])
        self.assertTrue(payload["listing"]["examples"])
        self.assertEqual("skill-demo", payload["tool"]["id"])

    def test_create_payload_infers_source_and_support_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "package.json").write_text(json.dumps({
                "repository": {"url": "git+https://github.com/taku-ai/demo-skill.git"},
                "bugs": {
                    "url": "https://github.com/taku-ai/demo-skill/issues",
                    "email": "support@taku.ai",
                },
                "privacyPolicyUrl": "https://taku.ai/privacy",
                "license": "Apache-2.0",
            }), encoding="utf-8")
            payload = draft_create_payload({
                "mode": "create",
                "source_path": str(root),
                "unit": {
                    "id": "skill-demo",
                    "type": "skill",
                    "name": "Demo Skill",
                    "description": "A useful local skill.",
                    "children": [],
                },
            })

        self.assertEqual("https://github.com/taku-ai/demo-skill", payload["listing"]["sourceUrl"])
        self.assertEqual("support@taku.ai", payload["listing"]["supportEmail"])
        self.assertEqual("https://taku.ai/privacy", payload["listing"]["privacyPolicyUrl"])
        self.assertEqual("Apache-2.0", payload["listing"]["license"])

    def test_listing_metadata_normalizes_to_worker_field_names(self) -> None:
        metadata = normalize_listing_metadata({
            "source_url": "https://example.com/source",
            "rights_basis": "explicit_permission",
            "source_author": " ".join(("Original", "Author")),
            "support_email": "support@example.com",
            "privacy_policy": "https://example.com/privacy",
        })

        self.assertEqual("https://example.com/source", metadata["sourceUrl"])
        self.assertEqual("explicit_permission", metadata["rightsBasis"])
        self.assertEqual("Original Author", metadata["sourceAuthor"])
        self.assertEqual("support@example.com", metadata["supportEmail"])
        self.assertEqual("https://example.com/privacy", metadata["privacyPolicyUrl"])

    def test_update_payload_inherits_listing_and_uses_exact_item_id(self) -> None:
        payload = draft_create_payload({
            "mode": "update",
            "item_id": "11111111-1111-4111-8111-111111111111",
            "unit": {
                "id": "local-skill-demo",
                "type": "skill",
                "name": "Local renamed copy",
                "description": "Local description must not replace the listing by default.",
                "children": [],
            },
        })

        self.assertEqual("update", payload["mode"])
        self.assertEqual("11111111-1111-4111-8111-111111111111", payload["itemId"])
        self.assertTrue(payload["inheritListing"])
        self.assertEqual({}, payload["listing"])
        self.assertEqual("Local renamed copy", payload["tool"]["name"])

    def test_generate_listing_icon_uses_taku_endpoint(self) -> None:
        self.client.generate_listing_icon({"draft": {"title": "Demo"}, "capabilities": []})
        call = self.transport.calls[-1]
        self.assertEqual("POST", call["method"])
        self.assertTrue(call["url"].endswith("/marketplace/icons/generate"))
        self.assertEqual("Bearer " + self.test_token, call["headers"]["Authorization"])

    def test_generate_listing_icon_can_use_separate_short_lived_token(self) -> None:
        primary_auth = "".join(("publisher", "-", "auth"))
        icon_auth = "".join(("icon", "-", "auth"))
        client = TakuPublisherClient(
            worker_url="https://worker.example.test",
            token=primary_auth,
            icon_token=icon_auth,
            allow_custom_worker_url=True,
            transport=self.transport,
        )
        client.generate_listing_icon({"draft": {"title": "Demo"}})
        self.assertEqual("Bearer " + icon_auth, self.transport.calls[-1]["headers"]["Authorization"])
        client.create_draft({"mode": "create"})
        self.assertEqual("Bearer " + primary_auth, self.transport.calls[-1]["headers"]["Authorization"])

    def test_public_marketplace_reads_never_send_authorization(self) -> None:
        self.client.search_marketplace(
            search="weekly helper",
            item_kind="app",
            limit=5,
            offset=10,
        )
        search_call = self.transport.calls[-1]
        self.assertNotIn("Authorization", search_call["headers"])
        self.assertIn("/marketplace/items?", search_call["url"])
        self.assertIn("source=all", search_call["url"])
        self.assertIn("q=weekly+helper", search_call["url"])
        self.assertIn("kind=app", search_call["url"])
        self.assertIn("limit=5", search_call["url"])
        self.assertIn("cursor=10", search_call["url"])
        self.assertNotIn("type=", search_call["url"])

        self.client.get_marketplace_item(
            "11111111-1111-4111-8111-111111111111",
        )
        show_call = self.transport.calls[-1]
        self.assertNotIn("Authorization", show_call["headers"])

    def test_public_package_download_never_forwards_authorization(self) -> None:
        package = self.client.download_public_package(
            "https://cdn.example.test/community-skill.zip",
            max_bytes=1024,
        )
        self.assertTrue(package)
        download_call = self.transport.calls[-1]
        self.assertEqual("GET", download_call["method"])
        self.assertNotIn("Authorization", download_call["headers"])
        self.assertNotIn("Cookie", download_call["headers"])

    def test_response_candidates_include_icon_payloads(self) -> None:
        candidates = response_candidates({
            "ok": True,
            "icon": {"imageUrl": "https://cdn.example.test/icon.png"},
        })
        self.assertTrue(any(candidate.get("imageUrl") for candidate in candidates))

    def test_create_payload_infers_readme_license_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "README.md").write_text("# Demo\n\n## License\n\nMIT - Use freely.\n", encoding="utf-8")
            payload = draft_create_payload({
                "mode": "create",
                "source_path": str(root),
                "unit": {
                    "id": "skill-demo",
                    "type": "skill",
                    "name": "Demo Skill",
                    "description": "A useful local skill.",
                    "children": [],
                },
            })
        self.assertEqual("MIT", payload["listing"]["license"])


if __name__ == "__main__":
    unittest.main()
