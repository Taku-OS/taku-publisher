from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .constants import (
    EXCLUDED_DIR_NAMES,
    EXCLUDED_FILE_NAMES,
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_TOTAL_BYTES,
    SCHEMA_VERSION,
    SECRET_DIR_NAMES,
    SECRET_FILE_SUFFIXES,
    SUPPORTED_MODES,
)
from .discovery import inspect_selected_unit
from .util import (
    PublisherError,
    atomic_write_json,
    draft_directory,
    make_draft_id,
    normalized_relative,
    save_state,
    secure_directory,
    set_tree_read_only,
    set_tree_writable,
    sha256_file,
)


ENV_FILE_PATTERN = re.compile(r"^\.env(?:[._-].*)?$", re.IGNORECASE)
ENV_TEMPLATE_PATTERN = re.compile(r"^\.env(?:[._-](?:example|sample|template))$", re.IGNORECASE)
PUBLISHER_BUILD_ONLY_DIRECTORIES = {
    "packages/repo-to-stax-converter/template",
}


def initialize_draft(
    *,
    workspace: Path,
    source: Path,
    unit_type: str,
    mode: str,
    item_id: str | None = None,
    draft_id: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    if mode not in SUPPORTED_MODES:
        raise PublisherError(f"Unsupported publish mode: {mode}", code="invalid_publish_mode")
    normalized_item_id = str(item_id or "").strip()
    if mode == "update" and not normalized_item_id:
        raise PublisherError(
            "Update mode requires an explicit platform itemId. A name match is never enough.",
            code="missing_item_id",
        )
    if mode == "create" and normalized_item_id:
        raise PublisherError("Create mode must not include an itemId.", code="unexpected_item_id")

    workspace = workspace.expanduser().resolve()
    selected = inspect_selected_unit(source, unit_type, workspace)
    local_draft_id = draft_id or make_draft_id()
    directory = draft_directory(local_draft_id)
    if directory.exists():
        raise PublisherError("Local draft already exists; choose a new draft ID.", code="draft_exists")
    secure_directory(directory)
    now = datetime.now(timezone.utc).isoformat()
    state: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "draft_id": local_draft_id,
        "status": "selected",
        "mode": mode,
        "item_id": normalized_item_id or None,
        "workspace_path": str(workspace),
        "source_path": selected["path"],
        "unit": selected,
        "created_at": now,
        "updated_at": now,
        "remote_draft_id": None,
        "remote_artifact_id": None,
    }
    save_state(directory, state)
    return directory, state


def stage_selected(directory: Path, state: dict[str, Any]) -> dict[str, Any]:
    staging = directory / "staging"
    if staging.exists():
        raise PublisherError(
            "This draft already has an immutable staging snapshot. Start a new local draft to restage source changes.",
            code="staging_exists",
        )

    source = Path(state["source_path"]).expanduser().resolve()
    if not source.exists():
        raise PublisherError("Selected source no longer exists.", code="missing_source")
    temporary = directory / f".staging-{os.getpid()}"
    if temporary.exists():
        set_tree_writable(temporary)
        shutil.rmtree(temporary)
    secure_directory(temporary)
    exclusions: list[dict[str, str]] = []
    copied = _copy_source(source, temporary, exclusions)
    if copied["file_count"] == 0:
        set_tree_writable(temporary)
        shutil.rmtree(temporary)
        raise PublisherError("No publishable files remain after staging exclusions.", code="empty_staging")

    manifest = snapshot_manifest(temporary)
    os.replace(temporary, staging)
    set_tree_read_only(staging)
    atomic_write_json(directory / "file-list.json", manifest)
    atomic_write_json(directory / "exclusions.json", {
        "schema_version": SCHEMA_VERSION,
        "excluded": exclusions,
        "count": len(exclusions),
    })

    state.update({
        "status": "staged",
        "stage_sha256": manifest["stage_sha256"],
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    save_state(directory, state)
    return {
        "stage_sha256": manifest["stage_sha256"],
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "excluded": exclusions,
    }


def assert_stage_unchanged(directory: Path, state: dict[str, Any]) -> dict[str, Any]:
    staging = directory / "staging"
    if not staging.is_dir():
        raise PublisherError("Staging snapshot is missing.", code="missing_staging")
    current = snapshot_manifest(staging)
    expected = state.get("stage_sha256")
    if not expected or current["stage_sha256"] != expected:
        raise PublisherError(
            "The immutable staging snapshot changed after confirmation. Start a new local draft.",
            code="staging_changed",
            details={"expected": expected, "actual": current["stage_sha256"]},
        )
    return current


def snapshot_manifest(root: Path) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    total_bytes = 0
    for current_root, directories, files in os.walk(root, topdown=True, followlinks=False):
        current = Path(current_root)
        directories[:] = sorted(directories)
        for file_name in sorted(files):
            file_path = current / file_name
            if file_path.is_symlink() or not file_path.is_file():
                raise PublisherError("Staging contains a symlink or non-regular file.", code="unsafe_staging")
            relative = normalized_relative(file_path, root)
            size = file_path.stat().st_size
            entries.append({
                "path": relative,
                "size": size,
                "sha256": sha256_file(file_path),
            })
            total_bytes += size
    canonical = "".join(
        f"{entry['path']}\0{entry['size']}\0{entry['sha256']}\n" for entry in entries
    ).encode("utf-8")
    return {
        "schema_version": SCHEMA_VERSION,
        "files": entries,
        "file_count": len(entries),
        "total_bytes": total_bytes,
        "stage_sha256": hashlib.sha256(canonical).hexdigest(),
    }


def _copy_source(source: Path, target: Path, exclusions: list[dict[str, str]]) -> dict[str, int]:
    counters = {"file_count": 0, "total_bytes": 0}
    if source.is_file():
        _copy_file(source, target / source.name, source.parent, counters, exclusions)
        return counters
    if not source.is_dir():
        raise PublisherError("Selected source must be a file or directory.", code="invalid_source")

    def visit(current: Path) -> None:
        for entry in sorted(os.scandir(current), key=lambda item: item.name.lower()):
            entry_path = Path(entry.path)
            relative = normalized_relative(entry_path, source)
            if entry.is_symlink():
                exclusions.append({"path": relative, "reason": "symlink"})
                continue
            if entry.is_dir(follow_symlinks=False):
                reason = (
                    "publisher_build_only_directory"
                    if relative in PUBLISHER_BUILD_ONLY_DIRECTORIES
                    else _excluded_directory_reason(entry.name)
                )
                if reason:
                    exclusions.append({"path": relative, "reason": reason})
                    continue
                visit(entry_path)
                continue
            if not entry.is_file(follow_symlinks=False):
                exclusions.append({"path": relative, "reason": "non_regular_file"})
                continue
            _copy_file(entry_path, target / relative, source, counters, exclusions)

    visit(source)
    return counters


def _copy_file(
    source: Path,
    destination: Path,
    root: Path,
    counters: dict[str, int],
    exclusions: list[dict[str, str]],
) -> None:
    relative = normalized_relative(source, root)
    reason = _excluded_file_reason(source.name)
    if reason:
        exclusions.append({"path": relative, "reason": reason})
        return
    file_stat = source.stat(follow_symlinks=False)
    if not stat.S_ISREG(file_stat.st_mode):
        exclusions.append({"path": relative, "reason": "non_regular_file"})
        return
    if file_stat.st_size > MAX_FILE_BYTES:
        raise PublisherError(
            f"File exceeds the {MAX_FILE_BYTES}-byte limit: {relative}",
            code="file_too_large",
        )
    if counters["file_count"] + 1 > MAX_FILES:
        raise PublisherError(f"Package exceeds the {MAX_FILES}-file limit.", code="too_many_files")
    if counters["total_bytes"] + file_stat.st_size > MAX_TOTAL_BYTES:
        raise PublisherError(f"Package exceeds the {MAX_TOTAL_BYTES}-byte limit.", code="package_too_large")
    secure_directory(destination.parent)
    with source.open("rb") as input_handle, destination.open("xb") as output_handle:
        shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
    destination.chmod(0o600)
    counters["file_count"] += 1
    counters["total_bytes"] += file_stat.st_size


def _excluded_directory_reason(name: str) -> str | None:
    lower = name.lower()
    if lower in SECRET_DIR_NAMES:
        return "secret_directory"
    if lower in EXCLUDED_DIR_NAMES:
        return "cache_or_build_directory"
    return None


def _excluded_file_reason(name: str) -> str | None:
    lower = name.lower()
    suffix = Path(lower).suffix
    if lower.startswith("creator-profile-draft.") or lower == "creator-profile-summary.md":
        return "local_creator_profile_draft"
    if lower in EXCLUDED_FILE_NAMES:
        return "secret_or_machine_file"
    if ENV_FILE_PATTERN.match(name) and not ENV_TEMPLATE_PATTERN.match(name):
        return "environment_file"
    if suffix in SECRET_FILE_SUFFIXES:
        return "secret_file_extension"
    return None
