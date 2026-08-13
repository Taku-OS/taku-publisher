from __future__ import annotations

import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from taku_publisher.marketplace import (
    install_codex_skill,
    install_preflight,
    marketplace_items,
)
from taku_publisher.util import PublisherError


def zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def install_response(package: bytes, **item_overrides):
    item = {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Community Skill",
        "slug": "community-skill",
        "type": "skill",
        "status": "published",
        "shortDescription": "A safe community skill.",
        "currentVersion": 2,
        "metadata": {
            "publisher": {
                "requirements": {
                    "secrets": [
                        {
                            "name": "EXAMPLE_API_KEY",
                            "purpose": "Call the example API.",
                            "required": True,
                        }
                    ],
                    "env": [],
                }
            }
        },
        **item_overrides,
    }
    return {
        "data": {
            "item": item,
            "access": {"allowed": True, "reason": "public"},
            "latestVersion": {"versionNumber": 2},
            "package": {
                "versionNumber": 2,
                "contentHash": hashlib.sha256(package).hexdigest(),
                "fileSizeBytes": len(package),
            },
            "downloadUrl": "https://cdn.example.test/community-skill.zip",
        }
    }


class FakeClient:
    def __init__(self, package: bytes):
        self.package = package
        self.downloads = 0
        self.records: list[tuple[str, int]] = []

    def download_public_package(self, url: str, *, max_bytes: int) -> bytes:
        self.downloads += 1
        if len(self.package) > max_bytes:
            raise AssertionError("fixture package is unexpectedly large")
        return self.package

    def record_marketplace_install(self, item_id: str, version: int):
        self.records.append((item_id, version))
        return {"ok": True}


class MarketplaceInstallTests(unittest.TestCase):
    def test_search_output_is_public_and_compact(self) -> None:
        items = marketplace_items({
            "data": [
                {
                    "id": "11111111-1111-4111-8111-111111111111",
                    "name": "Community Skill",
                    "slug": "community-skill",
                    "type": "skill",
                    "status": "published",
                    "metadata": {
                        "private": "must-not-leak",
                        "publisher": {
                            "requirements": {
                                "secrets": [
                                    {
                                        "name": "EXAMPLE_API_KEY",
                                        "purpose": "Call the API",
                                    }
                                ]
                            }
                        },
                    },
                    "installOffer": {
                        "installability": "installable",
                        "displayKind": "skill",
                        "cta": "try-on-taku",
                        "deepLink": "taku://stax/install?item=11111111-1111-4111-8111-111111111111",
                    },
                }
            ]
        })

        self.assertEqual(1, len(items))
        self.assertNotIn("metadata", items[0])
        self.assertNotIn("storagePath", items[0])
        self.assertEqual("skill", items[0]["display_kind"])
        self.assertEqual("try-on-taku", items[0]["cta"])
        self.assertTrue(items[0]["codex_install_supported"])
        self.assertEqual("EXAMPLE_API_KEY", items[0]["configuration_requirements"][0]["name"])

    def test_preflight_requires_published_skill_and_access(self) -> None:
        package = zip_bytes({"SKILL.md": b"---\nname: demo\n---\n"})
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(PublisherError, "published"):
                install_preflight(
                    install_response(package, status="draft"),
                    item_id="11111111-1111-4111-8111-111111111111",
                    install_root=Path(temporary),
                )

    def test_missing_or_mismatched_confirmation_never_downloads(self) -> None:
        package = zip_bytes({"SKILL.md": b"---\nname: demo\n---\n"})
        client = FakeClient(package)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(PublisherError, "confirmation"):
                install_codex_skill(
                    client,
                    install_response(package),
                    item_id="11111111-1111-4111-8111-111111111111",
                    confirm_item_id="22222222-2222-4222-8222-222222222222",
                    install_root=Path(temporary),
                )
        self.assertEqual(0, client.downloads)
        self.assertEqual([], client.records)

    def test_hash_mismatch_does_not_create_target(self) -> None:
        package = zip_bytes({"SKILL.md": b"---\nname: demo\n---\n"})
        response = install_response(package)
        response["data"]["package"]["contentHash"] = "0" * 64
        client = FakeClient(package)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(PublisherError, "SHA-256"):
                install_codex_skill(
                    client,
                    response,
                    item_id="11111111-1111-4111-8111-111111111111",
                    confirm_item_id="11111111-1111-4111-8111-111111111111",
                    install_root=root,
                )
            self.assertFalse((root / "community-skill").exists())

    def test_path_traversal_package_is_rejected_without_partial_install(self) -> None:
        package = zip_bytes({
            "SKILL.md": b"---\nname: demo\n---\n",
            "../escape.txt": b"no",
        })
        client = FakeClient(package)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(PublisherError, "unsafe file path"):
                install_codex_skill(
                    client,
                    install_response(package),
                    item_id="11111111-1111-4111-8111-111111111111",
                    confirm_item_id="11111111-1111-4111-8111-111111111111",
                    install_root=root,
                )
            self.assertFalse((root / "community-skill").exists())
            self.assertFalse((root.parent / "escape.txt").exists())

    def test_valid_skill_is_installed_atomically_and_recorded(self) -> None:
        package = zip_bytes({
            "SKILL.md": b"---\nname: community-skill\n---\n",
            "references/guide.md": b"# Guide\n",
            ".taku/manifest.json": b"{}",
        })
        client = FakeClient(package)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = install_codex_skill(
                client,
                install_response(package),
                item_id="11111111-1111-4111-8111-111111111111",
                confirm_item_id="11111111-1111-4111-8111-111111111111",
                install_root=root,
            )

            target = root / "community-skill"
            self.assertEqual("installed", result["status"])
            self.assertTrue((target / "SKILL.md").is_file())
            self.assertTrue((target / "references" / "guide.md").is_file())
            self.assertEqual(
                [("11111111-1111-4111-8111-111111111111", 2)],
                client.records,
            )
            self.assertEqual(
                "EXAMPLE_API_KEY",
                result["configuration_requirements"][0]["name"],
            )

    def test_existing_skill_is_not_overwritten(self) -> None:
        package = zip_bytes({"SKILL.md": b"new"})
        client = FakeClient(package)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "community-skill"
            target.mkdir()
            (target / "SKILL.md").write_text("existing", encoding="utf-8")

            with self.assertRaisesRegex(PublisherError, "will not overwrite"):
                install_codex_skill(
                    client,
                    install_response(package),
                    item_id="11111111-1111-4111-8111-111111111111",
                    confirm_item_id="11111111-1111-4111-8111-111111111111",
                    install_root=root,
                )
            self.assertEqual("existing", (target / "SKILL.md").read_text())
            self.assertEqual(0, client.downloads)


if __name__ == "__main__":
    unittest.main()
