from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE_ROOT = ROOT / "dist" / "marketplaces" / "codex" / "taku"
CLAUDE_MARKETPLACE_ROOT = ROOT / "dist" / "marketplaces" / "claude" / "taku"


class AdapterBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(
            ["npm", "run", "build:adapters"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_codex_marketplace_points_to_packaged_plugin(self) -> None:
        marketplace_path = MARKETPLACE_ROOT / ".agents" / "plugins" / "marketplace.json"
        marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))

        self.assertEqual("taku", marketplace["name"])
        self.assertEqual("Taku", marketplace["interface"]["displayName"])
        self.assertEqual(
            {
                "name": "taku-publisher",
                "source": {
                    "source": "local",
                    "path": "./plugins/taku-publisher",
                },
                "policy": {
                    "installation": "AVAILABLE",
                    "authentication": "ON_INSTALL",
                },
                "category": "Productivity",
            },
            marketplace["plugins"][0],
        )

    def test_codex_marketplace_contains_self_contained_runtime(self) -> None:
        plugin_root = MARKETPLACE_ROOT / "plugins" / "taku-publisher"

        self.assertTrue((plugin_root / ".codex-plugin" / "plugin.json").is_file())
        self.assertTrue(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "scripts"
                / "taku-publisher.mjs"
            ).is_file(),
        )
        host_adapter = json.loads(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "host-adapter.json"
            ).read_text(encoding="utf-8"),
        )
        self.assertEqual("codex", host_adapter["host"])
        self.assertFalse(any(plugin_root.rglob("*.py")))
        self.assertTrue(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "node_modules"
                / "@taku"
                / "publisher-runtime"
                / "dist"
                / "cli.js"
            ).is_file(),
        )

    def test_generated_plugins_exclude_template_build_artifacts_and_local_paths(self) -> None:
        generated_names = {
            ".biome",
            ".next",
            ".next-edit",
            ".next-preview",
            ".taku",
            ".vercel",
            "build",
            "coverage",
            "out",
        }
        local_home = str(Path.home()).encode("utf-8")

        for marketplace_root in (MARKETPLACE_ROOT, CLAUDE_MARKETPLACE_ROOT):
            plugin_root = marketplace_root / "plugins" / "taku-publisher"
            self.assertFalse(
                any(
                    path.is_dir() and path.name in generated_names
                    for path in plugin_root.rglob("*")
                ),
            )
            for file_path in plugin_root.rglob("*"):
                if not file_path.is_file() or file_path.stat().st_size > 2_000_000:
                    continue
                self.assertNotIn(
                    local_home,
                    file_path.read_bytes(),
                    f"generated plugin contains a local home path: {file_path}",
                )

    def test_codex_runtime_resolves_embedded_passport_core(self) -> None:
        skill_root = (
            MARKETPLACE_ROOT
            / "plugins"
            / "taku-publisher"
            / "skills"
            / "taku-publisher"
        )
        self.assertTrue(
            (
                skill_root
                / "node_modules"
                / "@taku"
                / "capability-contract"
                / "dist"
                / "index.js"
            ).is_file(),
        )
        self.assertTrue(
            (
                skill_root
                / "node_modules"
                / "@taku"
                / "passport-core"
                / "dist"
                / "index.js"
            ).is_file(),
        )
        script = """
const ai = await import('./creator/scripts/ai-setup.mjs');
const privacy = await import('./creator/scripts/privacy.mjs');
const snapshot = ai.buildAiSetupSnapshot({
  generatedAt: '2026-07-21T00:00:00.000Z',
  usedTools: [{
    id: 'skill-1',
    type: 'skill',
    source: 'codex',
    name: 'Review',
  }],
}, {
  items: [{
    id: 'skill-1',
    localPath: '/tmp/review/SKILL.md',
  }],
});
if (snapshot.schemaVersion !== 'taku.capability-snapshot.v1') {
  throw new Error('embedded Passport Core returned an invalid snapshot');
}
const publicValue = privacy.sanitizePublishJson({
  name: 'Review',
  localPath: '/tmp/review/SKILL.md',
});
if ('localPath' in publicValue) {
  throw new Error('embedded Passport Core exposed a private locator');
}
"""
        subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            cwd=skill_root,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_embedded_runtime_manifests_reference_only_shipped_files(self) -> None:
        packages_root = (
            MARKETPLACE_ROOT
            / "plugins"
            / "taku-publisher"
            / "skills"
            / "taku-publisher"
            / "node_modules"
            / "@taku"
        )
        for package_name in (
            "capability-contract",
            "passport-core",
            "publisher-runtime",
        ):
            package_root = packages_root / package_name
            manifest = json.loads(
                (package_root / "package.json").read_text(encoding="utf-8"),
            )
            self.assertNotIn("types", manifest)
            self.assertNotIn("scripts", manifest)
            self.assertNotIn("files", manifest)
            self.assertNotIn('"types"', json.dumps(manifest["exports"]))

            export_paths = []

            def collect_paths(value):
                if isinstance(value, str) and value.startswith("./"):
                    export_paths.append(value)
                elif isinstance(value, dict):
                    for child in value.values():
                        collect_paths(child)
                elif isinstance(value, list):
                    for child in value:
                        collect_paths(child)

            collect_paths(manifest["exports"])
            for export_path in export_paths:
                self.assertTrue(
                    (package_root / export_path).is_file(),
                    f"{package_name} has a dangling export: {export_path}",
                )

    def test_codex_manifest_stays_within_supported_prompt_budget(self) -> None:
        manifest_path = (
            MARKETPLACE_ROOT
            / "plugins"
            / "taku-publisher"
            / ".codex-plugin"
            / "plugin.json"
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual("0.3.14", manifest["version"])
        self.assertLessEqual(len(manifest["interface"]["defaultPrompt"]), 3)

    def test_claude_marketplace_points_to_packaged_plugin(self) -> None:
        marketplace_path = (
            CLAUDE_MARKETPLACE_ROOT
            / ".claude-plugin"
            / "marketplace.json"
        )
        marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))

        self.assertEqual("taku", marketplace["name"])
        self.assertEqual("taku-publisher", marketplace["plugins"][0]["name"])
        self.assertEqual(
            "./plugins/taku-publisher",
            marketplace["plugins"][0]["source"],
        )

    def test_claude_marketplace_contains_self_contained_runtime(self) -> None:
        plugin_root = CLAUDE_MARKETPLACE_ROOT / "plugins" / "taku-publisher"
        manifest = json.loads(
            (plugin_root / ".claude-plugin" / "plugin.json").read_text(
                encoding="utf-8",
            ),
        )

        self.assertEqual("0.3.14", manifest["version"])
        self.assertTrue(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "node_modules"
                / "qrcode-generator"
                / "dist"
                / "qrcode.mjs"
            ).is_file(),
        )
        self.assertTrue(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "scripts"
                / "taku-publisher.mjs"
            ).is_file(),
        )
        host_adapter = json.loads(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "host-adapter.json"
            ).read_text(encoding="utf-8"),
        )
        self.assertEqual("claude-code", host_adapter["host"])
        self.assertFalse(any(plugin_root.rglob("*.py")))
        self.assertTrue(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "creator"
                / "scripts"
                / "host-output.mjs"
            ).is_file(),
        )
        self.assertTrue(
            (
                plugin_root
                / "skills"
                / "taku-publisher"
                / "creator"
                / "scripts"
                / "creator-center.mjs"
            ).is_file(),
        )


if __name__ == "__main__":
    unittest.main()
