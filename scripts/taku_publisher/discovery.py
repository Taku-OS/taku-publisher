from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from .constants import (
    EXCLUDED_DIR_NAMES,
    MAX_DISCOVERY_DEPTH,
    SUPPORTED_TYPES,
    UNAVAILABLE_PUBLISH_TYPES,
)
from .util import PublisherError, normalized_relative


PLUGIN_MANIFESTS = (".codex-plugin/plugin.json", "taku.plugin.json", "plugin.json")
AGENT_FILE_NAMES = {"agent.md", "agents.md", "agent.json", "agent.yaml", "agent.yml"}
ACTION_PARENT_NAMES = {"action", "actions", "command", "commands", "workflow", "workflows"}
AGENT_PARENT_NAMES = {"agent", "agents"}


def discover_units(workspace: Path, explicit_source: Path | None = None) -> list[dict[str, Any]]:
    workspace = workspace.expanduser().resolve()
    if not workspace.is_dir():
        raise PublisherError("Workspace must be an existing directory.", code="invalid_workspace")
    if explicit_source is not None:
        raw_source = explicit_source.expanduser()
        if raw_source.is_symlink():
            raise PublisherError("An explicit publish source cannot be a symlink.", code="unsafe_source")
        source = raw_source.resolve()
        if not source.exists():
            raise PublisherError("Explicit source does not exist.", code="invalid_source")
        return _discover_explicit(source, workspace)

    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for current_root, directories, files in os.walk(workspace, topdown=True, followlinks=False):
        current = Path(current_root)
        depth = len(current.relative_to(workspace).parts)
        directories[:] = sorted(
            directory
            for directory in directories
            if directory.lower() not in EXCLUDED_DIR_NAMES
            and not (current / directory).is_symlink()
            and depth < MAX_DISCOVERY_DEPTH
        )
        files = sorted(files)

        plugin_manifest = _plugin_manifest(current)
        if plugin_manifest:
            _append_candidate(candidates, seen, _candidate("plugin", current, workspace, plugin_manifest))
        if "SKILL.md" in files:
            _append_candidate(candidates, seen, _candidate("skill", current, workspace, current / "SKILL.md"))

        for file_name in files:
            file_path = current / file_name
            lower = file_name.lower()
            parent = current.name.lower()
            if lower in AGENT_FILE_NAMES or (parent in AGENT_PARENT_NAMES and file_path.suffix.lower() == ".md"):
                if file_path.suffix.lower() in {".md", ".json", ".yaml", ".yml"}:
                    _append_candidate(candidates, seen, _candidate("agent", file_path, workspace, file_path))
            if parent in ACTION_PARENT_NAMES and file_path.suffix.lower() in {".md", ".json", ".yaml", ".yml"}:
                _append_candidate(candidates, seen, _candidate("action", file_path, workspace, file_path))

    return sorted(candidates, key=lambda entry: (entry["type"], entry["relative_path"], entry["id"]))


def inspect_selected_unit(source: Path, unit_type: str, workspace: Path) -> dict[str, Any]:
    assert_publish_type_available(unit_type)
    raw_source = source.expanduser()
    if raw_source.is_symlink():
        raise PublisherError("A selected publish unit cannot be a symlink.", code="unsafe_source")
    source = raw_source.resolve()
    workspace = workspace.expanduser().resolve()
    if not source.exists():
        raise PublisherError("Selected source does not exist.", code="invalid_source")

    entrypoint: Path
    if unit_type == "skill":
        root = source.parent if source.is_file() else source
        entrypoint = root / "SKILL.md"
        if not entrypoint.is_file():
            raise PublisherError("A skill source must contain SKILL.md.", code="invalid_skill")
        source = root
    elif unit_type == "plugin":
        if not source.is_dir():
            raise PublisherError("A plugin source must be a directory.", code="invalid_plugin")
        entrypoint = _plugin_manifest(source) or Path()
        if not entrypoint or not entrypoint.is_file():
            raise PublisherError(
                "A plugin source must contain .codex-plugin/plugin.json, taku.plugin.json, or plugin.json.",
                code="invalid_plugin",
            )
    else:
        if source.is_file():
            entrypoint = source
        else:
            expected = [source / name for name in sorted(AGENT_FILE_NAMES)] if unit_type == "agent" else []
            entrypoint = next((path for path in expected if path.is_file()), Path())
            if not entrypoint:
                supported = sorted(
                    path for path in source.iterdir()
                    if path.is_file() and path.suffix.lower() in {".md", ".json", ".yaml", ".yml"}
                )
                entrypoint = supported[0] if supported else Path()
        if not entrypoint or not entrypoint.is_file():
            raise PublisherError(f"The selected {unit_type} has no supported definition file.", code=f"invalid_{unit_type}")

    candidate = _candidate(unit_type, source, workspace, entrypoint)
    if unit_type == "plugin":
        candidate["children"] = discover_plugin_children(source)
    return candidate


def assert_publish_type_available(unit_type: str) -> None:
    if unit_type in UNAVAILABLE_PUBLISH_TYPES:
        raise PublisherError(
            f"{unit_type} publishing is not available yet. Taku Publisher currently accepts Skills only.",
            code="publish_type_not_available",
        )
    if unit_type not in SUPPORTED_TYPES:
        raise PublisherError(f"Unsupported publish type: {unit_type}", code="unsupported_type")


def discover_plugin_children(plugin_root: Path) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    for candidate in discover_units(plugin_root):
        if candidate["type"] == "plugin" and candidate["relative_path"] == ".":
            continue
        children.append({
            "id": candidate["id"],
            "type": candidate["type"],
            "name": candidate["name"],
            "relative_path": candidate["relative_path"],
        })
    return children


def _discover_explicit(source: Path, workspace: Path) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if source.is_dir():
        manifest = _plugin_manifest(source)
        if manifest:
            candidates.append(_candidate("plugin", source, workspace, manifest))
        if (source / "SKILL.md").is_file():
            candidates.append(_candidate("skill", source, workspace, source / "SKILL.md"))
        if not any(candidate["type"] in SUPPORTED_TYPES for candidate in candidates):
            candidates.extend(discover_units(source))
    else:
        lower = source.name.lower()
        parent = source.parent.name.lower()
        if lower == "skill.md":
            candidates.append(_candidate("skill", source.parent, workspace, source))
        if lower in AGENT_FILE_NAMES or parent in AGENT_PARENT_NAMES:
            candidates.append(_candidate("agent", source, workspace, source))
        if parent in ACTION_PARENT_NAMES or source.suffix.lower() in {".md", ".json", ".yaml", ".yml"}:
            candidates.append(_candidate("action", source, workspace, source))
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for candidate in candidates:
        unique[(candidate["type"], candidate["path"])] = candidate
    return sorted(
        (candidate for candidate in unique.values() if candidate["type"] in SUPPORTED_TYPES),
        key=lambda entry: (entry["type"], entry["relative_path"]),
    )


def _plugin_manifest(root: Path) -> Path | None:
    for relative in PLUGIN_MANIFESTS:
        candidate = root / relative
        if candidate.is_file():
            return candidate
    return None


def _candidate(unit_type: str, source: Path, workspace: Path, entrypoint: Path) -> dict[str, Any]:
    source = source.resolve()
    entrypoint = entrypoint.resolve()
    try:
        relative_path = normalized_relative(source, workspace)
    except ValueError:
        relative_path = source.name
    metadata = _metadata(entrypoint, source)
    identifier = hashlib.sha256(f"{unit_type}\0{relative_path}\0{entrypoint.name}".encode("utf-8")).hexdigest()[:20]
    return {
        "id": f"{unit_type}_{identifier}",
        "type": unit_type,
        "name": metadata["name"],
        "description": metadata.get("description", ""),
        "path": str(source),
        "relative_path": relative_path,
        "entrypoint": str(entrypoint),
        "entrypoint_relative": (
            entrypoint.relative_to(source).as_posix()
            if source.is_dir() and _is_relative_to(entrypoint, source)
            else entrypoint.name
        ),
    }


def _metadata(entrypoint: Path, source: Path) -> dict[str, str]:
    fallback = source.stem if source.is_file() else source.name
    if entrypoint.suffix.lower() == ".json":
        try:
            value = json.loads(entrypoint.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                return {
                    "name": _text(value.get("name") or value.get("title")) or fallback,
                    "description": _text(value.get("description") or value.get("summary")),
                }
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            pass
    try:
        text = entrypoint.read_text(encoding="utf-8")[:64_000]
    except (OSError, UnicodeDecodeError):
        return {"name": fallback, "description": ""}
    frontmatter = _frontmatter(text)
    heading = re.search(r"^#\s+(.+?)\s*$", text, re.MULTILINE)
    return {
        "name": _text(frontmatter.get("name") or frontmatter.get("title")) or (heading.group(1).strip() if heading else fallback),
        "description": _text(frontmatter.get("description") or frontmatter.get("summary")),
    }


def _frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    output: dict[str, str] = {}
    for line in text[3:end].splitlines():
        match = re.match(r"^([A-Za-z0-9_-]+):\s*[\"']?(.*?)[\"']?\s*$", line)
        if match:
            output[match.group(1)] = match.group(2)
    return output


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", value).strip()[:500] if isinstance(value, str) else ""


def _append_candidate(
    candidates: list[dict[str, Any]],
    seen: set[tuple[str, str]],
    candidate: dict[str, Any],
) -> None:
    if candidate["type"] not in SUPPORTED_TYPES:
        return
    key = (candidate["type"], candidate["path"])
    if key not in seen:
        seen.add(key)
        candidates.append(candidate)


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
