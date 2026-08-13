from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
from pathlib import Path
from typing import Any

from .constants import SCHEMA_VERSION, publisher_home


class PublisherError(RuntimeError):
    def __init__(self, message: str, *, code: str = "publisher_error", details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def json_output(
    *,
    ok: bool = True,
    status: str,
    requires_action: bool = False,
    action_type: str | None = None,
    **data: Any,
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "ok": ok,
        "status": status,
        "requires_action": requires_action,
    }
    if action_type:
        output["action_type"] = action_type
    output.update(data)
    return output


def emit_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def secure_directory(path: Path, mode: int = 0o700) -> Path:
    path.mkdir(parents=True, exist_ok=True, mode=mode)
    try:
        path.chmod(mode)
    except OSError:
        pass
    return path


def atomic_write_bytes(path: Path, data: bytes, mode: int = 0o600) -> None:
    secure_directory(path.parent)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        path.chmod(mode)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    serialized = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    atomic_write_bytes(path, serialized.encode("utf-8"), mode)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise PublisherError(f"Required file does not exist: {path}", code="missing_file") from error
    except (OSError, json.JSONDecodeError) as error:
        raise PublisherError(f"Could not read JSON file: {path}", code="invalid_json") from error


def draft_directory(draft_id: str) -> Path:
    normalized = str(draft_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{2,127}", normalized):
        raise PublisherError("Invalid draft ID.", code="invalid_draft_id")
    root = secure_directory(publisher_home())
    candidate = (root / normalized).resolve()
    if candidate.parent != root.resolve():
        raise PublisherError("Draft path escapes publisher home.", code="unsafe_draft_path")
    return candidate


def load_state(draft_id: str) -> tuple[Path, dict[str, Any]]:
    directory = draft_directory(draft_id)
    state = read_json(directory / "state.json")
    if not isinstance(state, dict) or state.get("draft_id") != draft_id:
        raise PublisherError("Local draft state is invalid.", code="invalid_draft_state")
    return directory, state


def save_state(directory: Path, state: dict[str, Any]) -> None:
    atomic_write_json(directory / "state.json", state)


def make_draft_id() -> str:
    return f"local_{secrets.token_hex(12)}"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def ensure_within(path: Path, root: Path, *, label: str = "path") -> Path:
    resolved = path.expanduser().resolve()
    if not is_relative_to(resolved, root.expanduser().resolve()):
        raise PublisherError(f"{label} must stay inside the selected source.", code="unsafe_path")
    return resolved


def normalized_relative(path: Path, root: Path) -> str:
    relative = path.resolve().relative_to(root.resolve()).as_posix()
    if relative in {"", "."}:
        return "."
    if relative.startswith("/") or ".." in Path(relative).parts:
        raise PublisherError("Unsafe relative path.", code="unsafe_path")
    return relative


def set_tree_read_only(root: Path) -> None:
    for current_root, directories, files in os.walk(root, topdown=False, followlinks=False):
        current = Path(current_root)
        for name in files:
            target = current / name
            try:
                target.chmod(stat.S_IRUSR)
            except OSError:
                pass
        for name in directories:
            target = current / name
            try:
                target.chmod(stat.S_IRUSR | stat.S_IXUSR)
            except OSError:
                pass
    try:
        root.chmod(stat.S_IRUSR | stat.S_IXUSR)
    except OSError:
        pass


def set_tree_writable(root: Path) -> None:
    if not root.exists():
        return
    for current_root, directories, files in os.walk(root, topdown=False, followlinks=False):
        current = Path(current_root)
        for name in files:
            try:
                (current / name).chmod(0o600)
            except OSError:
                pass
        for name in directories:
            try:
                (current / name).chmod(0o700)
            except OSError:
                pass
    try:
        root.chmod(0o700)
    except OSError:
        pass
