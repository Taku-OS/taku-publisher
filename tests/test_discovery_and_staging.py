from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from taku_publisher.discovery import discover_units, inspect_selected_unit
from taku_publisher.util import PublisherError, set_tree_writable
from taku_publisher.workspace import initialize_draft, stage_selected


class DiscoveryAndStagingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.home = self.root / "publisher-home"
        self.previous_home = os.environ.get("TAKU_PUBLISHER_HOME")
        os.environ["TAKU_PUBLISHER_HOME"] = str(self.home)

    def tearDown(self) -> None:
        set_tree_writable(self.root)
        if self.previous_home is None:
            os.environ.pop("TAKU_PUBLISHER_HOME", None)
        else:
            os.environ["TAKU_PUBLISHER_HOME"] = self.previous_home
        self.temporary.cleanup()

    def test_discovers_only_skills_and_rejects_unopened_publish_types(self) -> None:
        workspace = self.root / "workspace"
        (workspace / "skill-one").mkdir(parents=True)
        (workspace / "skill-one" / "SKILL.md").write_text("---\nname: first-skill\n---\n# Skill\n", encoding="utf-8")
        (workspace / "actions").mkdir()
        (workspace / "actions" / "deploy.md").write_text("# Deploy\n", encoding="utf-8")
        (workspace / "agents").mkdir()
        (workspace / "agents" / "reviewer.md").write_text("# Reviewer\n", encoding="utf-8")
        (workspace / "agents" / "openai.yaml").write_text("interface: {}\n", encoding="utf-8")
        plugin = workspace / "plugin-one"
        (plugin / ".codex-plugin").mkdir(parents=True)
        (plugin / ".codex-plugin" / "plugin.json").write_text(
            json.dumps({"name": "plugin-one", "description": "A bundled plugin"}), encoding="utf-8"
        )
        (plugin / "skills" / "child").mkdir(parents=True)
        (plugin / "skills" / "child" / "SKILL.md").write_text("# Child\n", encoding="utf-8")

        candidates = discover_units(workspace)
        self.assertEqual({"skill"}, {item["type"] for item in candidates})
        self.assertFalse(any(item["entrypoint"].endswith("agents/openai.yaml") for item in candidates))
        self.assertTrue(any(item["name"] == "first-skill" for item in candidates))
        self.assertTrue(any(item["relative_path"].endswith("plugin-one/skills/child") for item in candidates))

        for unit_type, source in (
            ("action", workspace / "actions" / "deploy.md"),
            ("agent", workspace / "agents" / "reviewer.md"),
            ("plugin", plugin),
        ):
            with self.assertRaises(PublisherError) as raised:
                inspect_selected_unit(source, unit_type, workspace)
            self.assertEqual("publish_type_not_available", raised.exception.code)

    def test_update_mode_requires_item_id(self) -> None:
        workspace = self.root / "workspace"
        skill = workspace / "skill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("# Skill\n", encoding="utf-8")
        with self.assertRaisesRegex(PublisherError, "itemId"):
            initialize_draft(workspace=workspace, source=skill, unit_type="skill", mode="update")

    def test_staging_excludes_secrets_build_output_and_symlinks(self) -> None:
        workspace = self.root / "workspace"
        skill = workspace / "skill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("# Skill\n", encoding="utf-8")
        (skill / "main.py").write_text("print('ok')\n", encoding="utf-8")
        (skill / "auth.py").write_text("def login(): return True\n", encoding="utf-8")
        (skill / "credentials.py").write_text("def load_config(): return {}\n", encoding="utf-8")
        (skill / ".env").write_text("OPENAI_API_KEY=<your-key>\n", encoding="utf-8")
        (skill / ".env.example").write_text("OPENAI_API_KEY=<your-key>\n", encoding="utf-8")
        (skill / "node_modules").mkdir()
        (skill / "node_modules" / "ignored.js").write_text("ignored\n", encoding="utf-8")
        (skill / "linked").symlink_to(skill / "main.py")

        directory, state = initialize_draft(
            workspace=workspace,
            source=skill,
            unit_type="skill",
            mode="create",
            draft_id="draft_staging_test",
        )
        self.assertEqual(0o700, directory.stat().st_mode & 0o777)
        self.assertEqual(0o600, (directory / "state.json").stat().st_mode & 0o777)
        result = stage_selected(directory, state)
        paths = {entry["path"] for entry in json.loads((directory / "file-list.json").read_text())["files"]}
        self.assertIn("SKILL.md", paths)
        self.assertIn("main.py", paths)
        self.assertIn("auth.py", paths)
        self.assertIn("credentials.py", paths)
        self.assertIn(".env.example", paths)
        self.assertNotIn(".env", paths)
        self.assertNotIn("linked", paths)
        self.assertFalse(any(path.startswith("node_modules/") for path in paths))
        reasons = {entry["reason"] for entry in result["excluded"]}
        self.assertIn("environment_file", reasons)
        self.assertIn("symlink", reasons)
        self.assertIn("cache_or_build_directory", reasons)
        self.assertEqual(0o500, (directory / "staging").stat().st_mode & 0o777)


if __name__ == "__main__":
    unittest.main()
