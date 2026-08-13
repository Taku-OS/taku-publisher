from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any

from .constants import SCHEMA_VERSION, SUPPORTED_RUNTIME_PLATFORMS
from .discovery import assert_publish_type_available
from .scanner import assert_scan_ready
from .util import PublisherError, atomic_write_bytes, atomic_write_json, read_json, save_state, sha256_bytes
from .workspace import assert_stage_unchanged


CAPABILITY_CONTRACT_VERSION = "0.2.0"
CAPABILITY_PACKAGE_SCHEMA_VERSION = "taku.package.v1"
CAPABILITY_SNAPSHOT_SCHEMA_VERSION = "taku.capability-snapshot.v1"
GENERATED_PACKAGE_MANIFEST_PATH = ".taku/package.json"
GENERATED_MANIFEST_PATH = ".taku/manifest.json"
GENERATED_REQUIREMENTS_PATH = ".taku/requirements.json"
KIND_ALIASES = {
    "skill": "skill",
    "skills": "skill",
    "agent": "agent",
    "agents": "agent",
    "subagent": "agent",
    "subagents": "agent",
    "action": "workflow",
    "actions": "workflow",
    "command": "workflow",
    "commands": "workflow",
    "slash-command": "workflow",
    "slash_command": "workflow",
    "workflow": "workflow",
    "workflows": "workflow",
    "plugin": "plugin",
    "plugins": "plugin",
}


def build_bundle(directory: Path, state: dict[str, Any], output_path: Path | None = None) -> dict[str, Any]:
    unit = state.get("unit") if isinstance(state.get("unit"), dict) else {}
    assert_publish_type_available(str(unit.get("type") or ""))
    manifest = assert_stage_unchanged(directory, state)
    assert_scan_ready(directory, state)
    staging = directory / "staging"
    requirements = read_json(directory / "requirements.json")
    bundle_manifest = _bundle_manifest(state)
    generated = {
        GENERATED_MANIFEST_PATH: _canonical_json(bundle_manifest),
        GENERATED_REQUIREMENTS_PATH: _canonical_json(requirements),
    }
    archive_path = output_path or directory / "bundle.zip"
    if archive_path.exists() and output_path is None:
        raise PublisherError("Bundle already exists for this draft.", code="bundle_exists")
    archive_bytes, bundle_files = _create_reproducible_zip(staging, manifest["files"], generated, state, requirements)
    bundle_sha256 = sha256_bytes(archive_bytes)
    atomic_write_bytes(archive_path, archive_bytes)
    if output_path is None:
        atomic_write_bytes(directory / "bundle.sha256", f"{bundle_sha256}  bundle.zip\n".encode("ascii"))
        file_list = dict(manifest)
        file_list["bundle_files"] = bundle_files
        file_list["bundle_file_count"] = len(bundle_files)
        atomic_write_json(directory / "file-list.json", file_list)
        state.update({
            "status": "packaged",
            "bundle_sha256": bundle_sha256,
            "bundle_size": len(archive_bytes),
            "bundle_file_count": len(bundle_files),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        save_state(directory, state)
    return {
        "path": str(archive_path),
        "sha256": bundle_sha256,
        "size": len(archive_bytes),
        "file_count": len(bundle_files),
        "files": bundle_files,
    }


def verify_local_bundle(directory: Path, state: dict[str, Any]) -> Path:
    assert_stage_unchanged(directory, state)
    bundle_path = directory / "bundle.zip"
    if not bundle_path.is_file():
        raise PublisherError("Bundle has not been created.", code="missing_bundle")
    actual = sha256_bytes(bundle_path.read_bytes())
    if actual != state.get("bundle_sha256"):
        raise PublisherError("Bundle digest no longer matches local state.", code="bundle_changed")
    return bundle_path


def _bundle_manifest(state: dict[str, Any]) -> dict[str, Any]:
    unit = state.get("unit") or {}
    children = unit.get("children") if isinstance(unit.get("children"), list) else []
    return {
        "schema_version": SCHEMA_VERSION,
        "type": unit.get("type"),
        "name": unit.get("name"),
        "description": unit.get("description") or "",
        "entrypoint": unit.get("entrypoint_relative") or Path(str(unit.get("entrypoint") or "")).name,
        "capabilities": [
            {
                "id": child.get("id"),
                "type": child.get("type"),
                "name": child.get("name"),
                "path": child.get("relative_path"),
            }
            for child in children
            if isinstance(child, dict)
        ],
    }


def _package_manifest(state: dict[str, Any], files: list[dict[str, Any]], requirements: dict[str, Any]) -> dict[str, Any]:
    unit = state.get("unit") if isinstance(state.get("unit"), dict) else {}
    normalized_files = sorted(files, key=lambda item: str(item.get("path") or "").casefold())
    raw_kind = str(unit.get("type") or "").strip()
    source_kind = _normalize_capability_kind(raw_kind)
    if not source_kind:
        raise PublisherError("Package manifest requires a supported capability kind.", code="invalid_package_manifest")
    if source_kind == "plugin":
        raise PublisherError(
            "Plugin packages require an approved taku.package.v1 permission review.",
            code="plugin_permission_review_required",
        )
    name = str(unit.get("name") or unit.get("id") or "").strip() or f"Untitled {source_kind}"
    description = str(unit.get("description") or "").strip()
    capability_id = str(unit.get("id") or "").strip() or _stable_capability_id(
        source_kind,
        "taku",
        str(unit.get("entrypoint_relative") or unit.get("entrypoint") or name),
    )
    required_secrets = sorted({
        str(item.get("name") or "").strip()
        for item in requirements.get("secrets", [])
        if isinstance(item, dict) and _is_secret_name(str(item.get("name") or "").strip())
    })
    content_hash = sha256(_canonical_capability_json({"files": normalized_files}).encode("utf-8")).hexdigest()
    capability: dict[str, Any] = {
        "id": capability_id,
        "kind": "action" if source_kind == "workflow" else source_kind,
        "sourceKind": source_kind,
        "name": name[:160],
    }
    if description:
        capability["description"] = description[:2000]
    return {
        "schemaVersion": CAPABILITY_PACKAGE_SCHEMA_VERSION,
        "contractVersion": CAPABILITY_CONTRACT_VERSION,
        "channel": "publish",
        "packageVersion": "1.0.0",
        "capability": capability,
        "contentHash": content_hash,
        "compatibility": {
            "hosts": sorted(SUPPORTED_RUNTIME_PLATFORMS),
            "platforms": sorted(SUPPORTED_RUNTIME_PLATFORMS),
        },
        "files": normalized_files,
        "permissions": [],
        "requiredSecrets": required_secrets,
    }


def _canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _canonical_capability_json(value: Any) -> str:
    return json.dumps(_sort_deep(value), ensure_ascii=False, separators=(",", ":"))


def _sort_deep(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_deep(item) for item in value]
    if isinstance(value, dict):
        return {key: _sort_deep(value[key]) for key in sorted(value)}
    return value


def _normalize_capability_kind(value: str) -> str:
    return KIND_ALIASES.get(str(value or "").strip().lower(), "")


def _stable_capability_id(kind: str, source: str, locator: str) -> str:
    normalized_locator = str(locator or "").strip().replace("\\", "/").rstrip("/").lower()
    if not normalized_locator:
        normalized_locator = kind
    digest = sha256(f"{CAPABILITY_SNAPSHOT_SCHEMA_VERSION}\0{kind}\0{source}\0{normalized_locator}".encode("utf-8")).hexdigest()[:32]
    return f"cap_{digest}"


def _is_secret_name(value: str) -> bool:
    import re

    return bool(re.fullmatch(r"[A-Z][A-Z0-9_]{1,127}", value))


def _create_reproducible_zip(
    staging: Path,
    staged_files: list[dict[str, Any]],
    generated: dict[str, bytes],
    state: dict[str, Any],
    requirements: dict[str, Any],
) -> tuple[bytes, list[dict[str, Any]]]:
    import io

    memory = io.BytesIO()
    entries: list[tuple[str, bytes]] = []
    for entry in staged_files:
        relative = entry["path"]
        if relative in generated or relative.startswith(".taku/"):
            raise PublisherError("Source uses the reserved .taku package namespace.", code="reserved_package_path")
        entries.append((relative, (staging / relative).read_bytes()))
    entries.extend(generated.items())
    entries.sort(key=lambda item: item[0])
    package_files = [
        {
            "path": relative,
            "size": len(data),
            "sha256": sha256_bytes(data),
        }
        for relative, data in entries
    ]
    entries.append((
        GENERATED_PACKAGE_MANIFEST_PATH,
        _canonical_json(_package_manifest(state, package_files, requirements)),
    ))
    entries.sort(key=lambda item: item[0])

    file_list: list[dict[str, Any]] = []
    with zipfile.ZipFile(memory, mode="w", compression=zipfile.ZIP_STORED, strict_timestamps=True) as archive:
        for relative, data in entries:
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            mode = 0o755 if _is_executable_script(relative) else 0o644
            info.external_attr = (mode & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
            file_list.append({
                "path": relative,
                "size": len(data),
                "sha256": sha256_bytes(data),
            })
    return memory.getvalue(), file_list


def _is_executable_script(relative: str) -> bool:
    suffix = Path(relative).suffix.lower()
    return suffix in {".bash", ".command", ".sh", ".zsh"} or relative.startswith("bin/")
