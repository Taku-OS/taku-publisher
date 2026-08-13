from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.bundle import build_bundle
from taku_publisher.scanner import (
    apply_deep_scan_dispositions,
    build_platform_scan_payload,
    scan_staging,
)
from taku_publisher.util import PublisherError, atomic_write_json, set_tree_writable
from taku_publisher.workspace import initialize_draft, stage_selected


class ScanningAndBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.previous_home = os.environ.get("TAKU_PUBLISHER_HOME")
        os.environ["TAKU_PUBLISHER_HOME"] = str(self.root / "publisher-home")

    def tearDown(self) -> None:
        set_tree_writable(self.root)
        if self.previous_home is None:
            os.environ.pop("TAKU_PUBLISHER_HOME", None)
        else:
            os.environ["TAKU_PUBLISHER_HOME"] = self.previous_home
        self.temporary.cleanup()

    def test_legacy_unopened_type_cannot_be_packaged(self) -> None:
        with self.assertRaises(PublisherError) as raised:
            build_bundle(
                self.root,
                {"unit": {"type": "agent"}},
                self.root / "blocked.zip",
            )
        self.assertEqual("publish_type_not_available", raised.exception.code)

    def _draft(self, source_text: str, draft_id: str = "draft_scan_test"):
        workspace = self.root / draft_id / "workspace"
        skill = workspace / "skill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: safe-skill\n---\n# Safe\n", encoding="utf-8")
        (skill / "main.py").write_text(source_text, encoding="utf-8")
        directory, state = initialize_draft(
            workspace=workspace,
            source=skill,
            unit_type="skill",
            mode="create",
            draft_id=draft_id,
        )
        stage_selected(directory, state)
        return directory, state

    def test_real_credentials_block_and_are_redacted(self) -> None:
        fake_token = "sk-" + "proj-" + "1234567890abcdefghijklmnop"
        fake_database_url = "postgres" + "://user:super-secret-password@db.example.com/app"
        directory, state = self._draft(
            f"api_key = '{fake_token}'\n"
            f"url = '{fake_database_url}'\n"
        )
        result = scan_staging(directory, state)
        report = result["report"]
        self.assertGreaterEqual(report["summary"]["blocking"], 2)
        serialized = json.dumps(report)
        self.assertNotIn(fake_token, serialized)
        self.assertNotIn("super-secret-password", serialized)
        with self.assertRaises(PublisherError):
            build_bundle(directory, state, directory / "should-not-exist.zip")

    def test_session_state_field_assignment_is_not_credential_literal(self) -> None:
        directory, state = self._draft(
            "import streamlit as st\n"
            "st.session_state.channel_added = 'https://www.youtube.com/@example-channel'\n",
            draft_id="draft_session_state",
        )
        result = scan_staging(directory, state)
        categories = {finding["category"] for finding in result["report"]["findings"]}
        self.assertNotIn("credential_literal", categories)

    def test_credential_named_metadata_fields_are_not_literal_secrets(self) -> None:
        directory, state = self._draft(
            "const metrics = {\n"
            "  tokens: readPercentileRank(percentiles, ['tokens', 'tokenPercentile']),\n"
            "  accessToken: null,\n"
            "  publishToken: '',\n"
            "};\n",
            draft_id="draft_metadata_fields",
        )
        result = scan_staging(directory, state)
        categories = {finding["category"] for finding in result["report"]["findings"]}
        self.assertNotIn("credential_literal", categories)

    def test_fixture_named_credentials_are_not_literal_secrets(self) -> None:
        directory, state = self._draft(
            "token = 'publisher-timeout-fixture'\n",
            draft_id="draft_fixture_credential",
        )
        result = scan_staging(directory, state)
        categories = {finding["category"] for finding in result["report"]["findings"]}
        self.assertNotIn("credential_literal", categories)

    def test_loopback_urls_require_review_but_private_network_urls_block(self) -> None:
        private_url = "http://" + "192.168.1.24:8080"
        directory, state = self._draft(
            "local = 'http://127.0.0.1:7819'\n"
            f"private = '{private_url}'\n",
            draft_id="draft_network_urls",
        )
        result = scan_staging(directory, state)
        severities = {
            finding["category"]: finding["severity"]
            for finding in result["report"]["findings"]
        }
        self.assertEqual("review", severities["loopback_url"])
        self.assertEqual("block", severities["private_network_url"])

    def test_finding_limit_preserves_blockers_and_only_requires_review(self) -> None:
        fake_token = "sk-" + "proj-" + "1234567890abcdefghijklmnop"
        directory, state = self._draft(
            "open('review-me')\n" * 510 + f"api_key = '{fake_token}'\n",
            draft_id="draft_finding_limit",
        )
        result = scan_staging(directory, state)
        findings = result["report"]["findings"]
        self.assertEqual(500, len(findings))
        self.assertTrue(any(
            finding["category"] == "known_token" and finding["severity"] == "block"
            for finding in findings
        ))
        limit = next(finding for finding in findings if finding["category"] == "finding_limit")
        self.assertEqual("review", limit["severity"])

    def test_requirements_deep_review_and_reproducible_bundle(self) -> None:
        directory, state = self._draft(
            "import os\n"
            "key = os.environ['OPENAI_API_KEY']\n"
            "model = os.getenv('MODEL_NAME')\n"
            "gate = config.get('INTERNAL_GATE')\n"
            "response = requests.post('https://api.example.com/run', headers={'Authorization': 'Bearer ' + key})\n",
            draft_id="draft_reproducible",
        )
        result = scan_staging(directory, state)
        self.assertEqual(0, result["report"]["summary"]["blocking"])
        secret_names = {item["name"] for item in result["requirements"]["secrets"]}
        env_names = {item["name"] for item in result["requirements"]["env"]}
        self.assertEqual({"OPENAI_API_KEY"}, secret_names)
        self.assertEqual({"MODEL_NAME"}, env_names)
        with self.assertRaisesRegex(PublisherError, "Deep scan"):
            build_bundle(directory, state, directory / "premature.zip")

        template = result["disposition_template"]
        template["full_review_completed"] = True
        for disposition in template["dispositions"]:
            disposition["decision"] = "allow"
            disposition["rationale"] = "The endpoint is fixed and only declared request data is transmitted."
        template["requirement_updates"] = [{
            "name": "INTERNAL_GATE",
            "kind": "secret",
            "required": True,
            "purpose": "Authorizes requests to the creator configured service.",
            "sources": [{"path": "main.py", "line": 4}],
        }]
        dispositions_path = directory / "host-dispositions.json"
        atomic_write_json(dispositions_path, template)
        reviewed = apply_deep_scan_dispositions(directory, state, dispositions_path)
        self.assertFalse(reviewed["blocked"])
        merged_requirements = json.loads((directory / "requirements.json").read_text(encoding="utf-8"))
        self.assertIn("INTERNAL_GATE", {item["name"] for item in merged_requirements["secrets"]})

        first = build_bundle(directory, state, directory / "first.zip")
        second = build_bundle(directory, state, directory / "second.zip")
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual((directory / "first.zip").read_bytes(), (directory / "second.zip").read_bytes())
        self.assertTrue(any(item["path"] == ".taku/package.json" for item in first["files"]))
        self.assertTrue(any(item["path"] == ".taku/manifest.json" for item in first["files"]))
        self.assertTrue(any(item["path"] == ".taku/requirements.json" for item in first["files"]))
        with zipfile.ZipFile(directory / "first.zip") as archive:
            package_manifest = json.loads(archive.read(".taku/package.json").decode("utf-8"))
        self.assertEqual("taku.package.v1", package_manifest["schemaVersion"])
        self.assertEqual("publish", package_manifest["channel"])
        self.assertEqual(state["unit"]["id"], package_manifest["capability"]["id"])
        self.assertEqual("skill", package_manifest["capability"]["kind"])
        self.assertEqual(["claude-code", "codex", "taku"], package_manifest["compatibility"]["hosts"])
        self.assertEqual(["claude-code", "codex", "taku"], package_manifest["compatibility"]["platforms"])
        self.assertEqual(["INTERNAL_GATE", "OPENAI_API_KEY"], package_manifest["requiredSecrets"])
        package_file_paths = {item["path"] for item in package_manifest["files"]}
        self.assertIn(".taku/manifest.json", package_file_paths)
        self.assertIn(".taku/requirements.json", package_file_paths)
        self.assertNotIn(".taku/package.json", package_file_paths)

        state["bundle_sha256"] = first["sha256"]
        payload = build_platform_scan_payload(directory, state)
        self.assertEqual(first["sha256"], payload["packageSha256"])
        self.assertEqual("passed", payload["report"]["deep"]["status"])
        self.assertEqual(
            {"name", "purpose", "required"},
            set(payload["requirements"]["secrets"][0]),
        )
        self.assertNotIn("sources", json.dumps(payload))

    def test_changed_staging_invalidates_scan(self) -> None:
        directory, state = self._draft("print('safe')\n", draft_id="draft_changed_stage")
        scan_staging(directory, state)
        staged_file = directory / "staging" / "main.py"
        staged_file.chmod(0o600)
        staged_file.write_text("print('changed')\n", encoding="utf-8")
        with self.assertRaisesRegex(PublisherError, "changed"):
            scan_staging(directory, state)

    def test_publisher_repository_has_no_deterministic_blockers(self) -> None:
        directory, state = initialize_draft(
            workspace=ROOT,
            source=ROOT,
            unit_type="skill",
            mode="create",
            draft_id="draft_self_scan",
        )
        stage_selected(directory, state)
        result = scan_staging(directory, state)
        blocking = [
            (finding["category"], finding["path"], finding["line"])
            for finding in result["report"]["findings"]
            if finding["severity"] == "block"
        ]
        self.assertEqual([], blocking)


if __name__ == "__main__":
    unittest.main()
