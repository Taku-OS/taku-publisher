from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from .api import TakuPublisherClient, response_candidates
from .util import PublisherError


MAX_PACKAGE_BYTES = 20 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_FILES = 2_000
ITEM_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
SAFE_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def marketplace_items(response: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = response.get("data")
    if not isinstance(raw_items, list):
        raw_items = response.get("items")
    if not isinstance(raw_items, list):
        return []
    return [
        normalize_marketplace_item(item)
        for item in raw_items
        if isinstance(item, dict)
    ]


def marketplace_item(response: dict[str, Any]) -> dict[str, Any]:
    for candidate in response_candidates(response):
        if _first_string(candidate, "id", "itemId", "item_id"):
            return normalize_marketplace_item(candidate)
    raise PublisherError(
        "Marketplace response does not contain an item.",
        code="invalid_marketplace_response",
    )


def normalize_marketplace_item(item: dict[str, Any]) -> dict[str, Any]:
    metadata = _record(item.get("metadata"))
    publisher = _record(metadata.get("publisher"))
    offer = _record(
        item.get("installOffer")
        or item.get("install_offer")
        or metadata.get("taku_install_offer")
    )
    latest = _record(item.get("latestVersion") or item.get("latest_version"))
    requirements = _requirements_from_sources(latest, publisher, metadata)
    item_type = _first_string(item, "type", "kind").lower()
    display_kind = (
        _first_string(item, "displayKind", "display_kind")
        or _first_string(offer, "displayKind", "display_kind")
        or item_type
    )
    installability = (
        _first_string(item, "installability")
        or _first_string(offer, "installability")
    )
    return {
        "item_id": _first_string(item, "id", "itemId", "item_id"),
        "name": _first_string(item, "name", "title"),
        "slug": _first_string(item, "slug"),
        "type": item_type,
        "status": _first_string(item, "status").lower(),
        "short_description": _first_string(
            item,
            "shortDescription",
            "short_description",
        ),
        "description": _first_string(item, "description"),
        "creator": _first_string(
            item,
            "creatorDisplayName",
            "creator_display_name",
            "creatorUsername",
            "creator_username",
        ),
        "version": _first_positive_int(
            latest.get("versionNumber"),
            latest.get("version_number"),
            item.get("currentVersion"),
            item.get("current_version"),
        ),
        "install_count": _first_nonnegative_int(
            item.get("installCount"),
            item.get("install_count"),
        ),
        "categories": _strings(item.get("categories")),
        "tags": _strings(item.get("tags")),
        "platforms": _strings(item.get("platforms")),
        "installability": installability,
        "display_kind": display_kind,
        "cta": _first_string(offer, "cta"),
        "deep_link": _first_string(offer, "deepLink", "deep_link"),
        "external_url": (
            _first_string(item, "externalUrl", "external_url")
            or _first_string(offer, "externalUrl", "external_url")
        ),
        "codex_install_supported": item_type == "skill" and display_kind == "skill",
        "configuration_requirements": requirements,
    }


def install_preflight(
    response: dict[str, Any],
    *,
    item_id: str,
    install_root: Path,
) -> dict[str, Any]:
    contract = _install_contract(response)
    item = _record(contract.get("item"))
    normalized = normalize_marketplace_item({
        **item,
        "latestVersion": contract.get("latestVersion")
        or contract.get("latest_version"),
    })
    _validate_item_id(item_id)
    if normalized["item_id"] != item_id:
        raise PublisherError(
            "Install package item ID does not match the requested item.",
            code="install_item_mismatch",
        )
    if normalized["type"] != "skill":
        raise PublisherError(
            "This development installer currently supports Codex Skills only.",
            code="unsupported_install_type",
            details={"type": normalized["type"]},
        )
    if normalized["status"] != "published":
        raise PublisherError(
            "Only published Marketplace Skills can be installed.",
            code="marketplace_item_not_published",
        )
    access = _record(contract.get("access"))
    if access.get("allowed") is not True:
        raise PublisherError(
            "This account does not have access to the Marketplace Skill.",
            code="marketplace_access_denied",
            details={"reason": _first_string(access, "reason")},
        )
    slug = normalized["slug"]
    if not SAFE_SLUG_RE.fullmatch(slug):
        raise PublisherError(
            "Marketplace Skill has an unsafe install slug.",
            code="unsafe_install_slug",
        )
    version = _first_positive_int(
        _record(contract.get("package") or contract.get("installPackage")).get(
            "versionNumber"
        ),
        _record(contract.get("package") or contract.get("installPackage")).get(
            "version_number"
        ),
        normalized["version"],
    )
    if version is None:
        raise PublisherError(
            "Marketplace Skill has no installable version.",
            code="package_not_available",
        )
    package = _record(contract.get("package") or contract.get("installPackage"))
    expected_sha256 = _first_string(package, "contentHash", "content_hash").lower()
    if not SHA256_RE.fullmatch(expected_sha256):
        raise PublisherError(
            "Marketplace Skill package does not have a verifiable SHA-256.",
            code="missing_package_hash",
        )
    download_url = _first_string(contract, "downloadUrl", "download_url")
    if not download_url:
        raise PublisherError(
            "Marketplace Skill package is not available for download.",
            code="package_not_available",
        )
    destination = _safe_destination(install_root, slug)
    return {
        "item": normalized,
        "version": version,
        "expected_sha256": expected_sha256,
        "expected_size": _first_positive_int(
            package.get("fileSizeBytes"),
            package.get("file_size_bytes"),
        ),
        "download_url": download_url,
        "install_root": str(install_root),
        "target_dir": str(destination),
    }


def install_codex_skill(
    client: TakuPublisherClient,
    response: dict[str, Any],
    *,
    item_id: str,
    confirm_item_id: str,
    install_root: Path,
) -> dict[str, Any]:
    preflight = install_preflight(
        response,
        item_id=item_id,
        install_root=install_root,
    )
    if not confirm_item_id or confirm_item_id != item_id:
        raise PublisherError(
            "Install confirmation must exactly match the selected item ID.",
            code="install_confirmation_mismatch",
        )
    destination = Path(preflight["target_dir"])
    if destination.exists():
        raise PublisherError(
            "A Codex Skill with this Marketplace slug already exists. This installer will not overwrite it.",
            code="install_target_exists",
            details={"target_dir": str(destination)},
        )

    package_bytes = client.download_public_package(
        preflight["download_url"],
        max_bytes=MAX_PACKAGE_BYTES,
    )
    actual_sha256 = hashlib.sha256(package_bytes).hexdigest()
    if actual_sha256 != preflight["expected_sha256"]:
        raise PublisherError(
            "Marketplace Skill package SHA-256 does not match the server contract.",
            code="package_hash_mismatch",
        )
    expected_size = preflight["expected_size"]
    if expected_size is not None and len(package_bytes) != expected_size:
        raise PublisherError(
            "Marketplace Skill package size does not match the server contract.",
            code="package_size_mismatch",
        )

    _extract_skill_atomically(package_bytes, destination)
    record_warning = None
    try:
        client.record_marketplace_install(item_id, int(preflight["version"]))
    except PublisherError as error:
        record_warning = {
            "code": error.code,
            "message": str(error),
        }

    return {
        "status": (
            "installed_with_record_warning"
            if record_warning
            else "installed"
        ),
        "item": preflight["item"],
        "version": preflight["version"],
        "target_dir": str(destination),
        "sha256": actual_sha256,
        "configuration_requirements": preflight["item"][
            "configuration_requirements"
        ],
        "install_record_warning": record_warning,
        "next_action": "start_new_codex_task",
    }


def _extract_skill_atomically(package_bytes: bytes, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = Path(
        tempfile.mkdtemp(
            prefix=f".{destination.name}.install-",
            dir=str(destination.parent),
        )
    )
    try:
        with zipfile.ZipFile(io.BytesIO(package_bytes)) as archive:
            entries = _validated_entries(archive)
            for info, relative in entries:
                target = temporary.joinpath(*relative.parts)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info, "r") as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                mode = (info.external_attr >> 16) & 0o777
                target.chmod(0o755 if mode & 0o111 else 0o644)

        if not (temporary / "SKILL.md").is_file():
            raise PublisherError(
                "Marketplace package does not contain a root SKILL.md.",
                code="missing_skill_definition",
            )
        try:
            os.rename(temporary, destination)
        except FileExistsError as error:
            raise PublisherError(
                "A Codex Skill with this Marketplace slug already exists.",
                code="install_target_exists",
                details={"target_dir": str(destination)},
            ) from error
        temporary = None
    except PublisherError:
        raise
    except (OSError, zipfile.BadZipFile) as error:
        raise PublisherError(
            "Marketplace Skill package could not be installed safely.",
            code="invalid_skill_package",
        ) from error
    finally:
        if temporary is not None and temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)


def _validated_entries(
    archive: zipfile.ZipFile,
) -> list[tuple[zipfile.ZipInfo, PurePosixPath]]:
    infos = archive.infolist()
    if len(infos) > MAX_FILES:
        raise PublisherError(
            "Marketplace package contains too many files.",
            code="unsafe_skill_package",
        )
    total_size = 0
    seen: set[str] = set()
    result: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
    for info in infos:
        if "\\" in info.filename or "\x00" in info.filename:
            raise PublisherError(
                "Marketplace package contains an unsafe file path.",
                code="unsafe_skill_package",
            )
        relative = PurePosixPath(info.filename)
        if (
            relative.is_absolute()
            or not relative.parts
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            raise PublisherError(
                "Marketplace package contains an unsafe file path.",
                code="unsafe_skill_package",
            )
        collision_key = "/".join(relative.parts).casefold()
        if collision_key in seen:
            raise PublisherError(
                "Marketplace package contains duplicate file paths.",
                code="unsafe_skill_package",
            )
        seen.add(collision_key)

        mode = info.external_attr >> 16
        file_type = stat.S_IFMT(mode)
        if file_type == stat.S_IFLNK:
            raise PublisherError(
                "Marketplace package contains a symbolic link.",
                code="unsafe_skill_package",
            )
        if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise PublisherError(
                "Marketplace package contains an unsupported file type.",
                code="unsafe_skill_package",
            )
        total_size += info.file_size
        if info.file_size > MAX_UNCOMPRESSED_BYTES or total_size > MAX_UNCOMPRESSED_BYTES:
            raise PublisherError(
                "Marketplace package exceeds the extraction size limit.",
                code="unsafe_skill_package",
            )
        result.append((info, relative))
    return result


def _install_contract(response: dict[str, Any]) -> dict[str, Any]:
    data = response.get("data")
    if isinstance(data, dict):
        return data
    raise PublisherError(
        "Marketplace install response is invalid.",
        code="invalid_marketplace_response",
    )


def _requirements_from_sources(
    latest: dict[str, Any],
    publisher: dict[str, Any],
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    latest_metadata = _record(latest.get("metadata"))
    latest_publisher = _record(latest_metadata.get("publisher"))
    raw = (
        latest_publisher.get("requirements")
        or publisher.get("requirements")
        or metadata.get("requirements")
    )
    requirements = _record(raw)
    result: list[dict[str, Any]] = []
    for kind, key in (("secret", "secrets"), ("env", "env")):
        values = requirements.get(key)
        if not isinstance(values, list):
            continue
        for value in values:
            entry = _record(value)
            name = _first_string(entry, "name", "key")
            if not name:
                continue
            result.append(
                {
                    "kind": kind,
                    "name": name,
                    "purpose": _first_string(entry, "purpose", "description"),
                    "required": entry.get("required") is not False,
                }
            )
    return result


def _safe_destination(root: Path, slug: str) -> Path:
    resolved_root = root.expanduser().resolve()
    destination = (resolved_root / slug).resolve()
    if destination.parent != resolved_root:
        raise PublisherError(
            "Marketplace Skill install target escapes the Codex skills directory.",
            code="unsafe_install_target",
        )
    return destination


def _validate_item_id(value: str) -> None:
    if not ITEM_ID_RE.fullmatch(str(value or "").strip()):
        raise PublisherError(
            "Marketplace item ID must be a UUID.",
            code="invalid_item_id",
        )


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_string(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for entry in value:
        if isinstance(entry, str) and entry.strip() and entry.strip() not in result:
            result.append(entry.strip())
    return result


def _first_positive_int(*values: Any) -> int | None:
    for value in values:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return None


def _first_nonnegative_int(*values: Any) -> int:
    for value in values:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed >= 0:
            return parsed
    return 0
