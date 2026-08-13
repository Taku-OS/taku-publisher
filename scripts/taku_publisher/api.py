from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode, urljoin, urlparse

from .auth import resolve_auth
from .constants import (
    DEFAULT_WORKER_URL,
    PUBLISHER_USER_AGENT,
    SCHEMA_VERSION,
    SUPPORTED_RUNTIME_PLATFORMS,
)
from .util import PublisherError


Transport = Callable[[str, str, dict[str, str], bytes | None, float], tuple[int, dict[str, str], bytes]]
DEFAULT_MARKETPLACE_CATEGORY = "writing-content"
LISTING_KEY_ALIASES = {
    "short_description": "shortDescription",
    "icon_url": "iconUrl",
    "source_url": "sourceUrl",
    "upstream_url": "sourceUrl",
    "upstreamUrl": "sourceUrl",
    "source_kind": "sourceKind",
    "authorship_kind": "authorshipKind",
    "publishing_rights": "authorshipKind",
    "publishingRights": "authorshipKind",
    "rights_basis": "rightsBasis",
    "source_notes": "sourceNotes",
    "source_author": "sourceAuthor",
    "support_email": "supportEmail",
    "privacy_policy_url": "privacyPolicyUrl",
    "privacyPolicy": "privacyPolicyUrl",
    "privacy_policy": "privacyPolicyUrl",
}


class TakuPublisherClient:
    def __init__(
        self,
        *,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str | None = None,
        icon_token: str | None = None,
        timeout: float = 30.0,
        allow_custom_worker_url: bool = False,
        transport: Transport | None = None,
    ) -> None:
        self.worker_url = _validate_worker_url(worker_url, allow_custom_worker_url).rstrip("/")
        self.token = str(token or "").strip()
        self.icon_token = str(icon_token or "").strip()
        self.timeout = timeout
        self.transport = transport or _default_transport

    @classmethod
    def from_environment(
        cls,
        *,
        worker_url: str = DEFAULT_WORKER_URL,
        token_env: str = "TAKU_BEARER_TOKEN",
        timeout: float = 30.0,
        allow_custom_worker_url: bool = False,
        transport: Transport | None = None,
    ) -> "TakuPublisherClient":
        auth = resolve_auth(token_env=token_env)
        return cls(
            worker_url=worker_url,
            token=auth.token,
            icon_token=auth.icon_token,
            timeout=timeout,
            allow_custom_worker_url=allow_custom_worker_url,
            transport=transport,
        )

    def create_draft(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json("POST", "/stax/publisher/drafts", payload)

    def generate_listing_icon(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json(
            "POST",
            "/marketplace/icons/generate",
            payload,
            token=self.icon_token or self.token,
        )

    def get_draft(self, draft_id: str) -> dict[str, Any]:
        return self._json("GET", f"/stax/publisher/drafts/{_segment(draft_id)}")

    def update_draft(self, draft_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return self._json("PATCH", f"/stax/publisher/drafts/{_segment(draft_id)}", patch)

    def submit_scan_report(self, draft_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json("POST", f"/stax/publisher/drafts/{_segment(draft_id)}/scan-report", payload)

    def presign_artifact(self, draft_id: str, *, size: int, sha256: str) -> dict[str, Any]:
        return self._json(
            "POST",
            f"/stax/publisher/drafts/{_segment(draft_id)}/artifacts/presign",
            {"size": size, "sha256": sha256, "contentType": "application/zip"},
        )

    def upload_signed(self, upload_url: str, bundle_path: Path, headers: dict[str, str] | None = None) -> None:
        parsed = urlparse(upload_url)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname:
            raise PublisherError("Presigned upload URL is invalid.", code="invalid_upload_url")
        if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise PublisherError("Presigned uploads must use HTTPS outside loopback.", code="unsafe_upload_url")
        data = bundle_path.read_bytes()
        request_headers = {"Content-Type": "application/zip", "Content-Length": str(len(data))}
        request_headers["User-Agent"] = PUBLISHER_USER_AGENT
        for name, value in (headers or {}).items():
            if name.lower() in {"authorization", "cookie", "proxy-authorization", "x-taku-auth"}:
                raise PublisherError("Presigned upload headers contain a forbidden credential header.", code="unsafe_upload_headers")
            request_headers[name] = value
        status, _, body = self.transport("PUT", upload_url, request_headers, data, self.timeout)
        if status < 200 or status >= 300:
            raise PublisherError(
                f"Presigned upload failed with HTTP {status}: {_body_preview(body)}",
                code="artifact_upload_failed",
            )

    def complete_artifact(
        self,
        draft_id: str,
        artifact_id: str,
        *,
        size: int,
        sha256: str,
    ) -> dict[str, Any]:
        return self._json(
            "POST",
            f"/stax/publisher/drafts/{_segment(draft_id)}/artifacts/{_segment(artifact_id)}/complete",
            {"size": size, "sha256": sha256},
        )

    def submit_draft(self, draft_id: str) -> dict[str, Any]:
        return self._json("POST", f"/stax/publisher/drafts/{_segment(draft_id)}/submit", {})

    def get_status(self, draft_id: str) -> dict[str, Any]:
        return self._json("GET", f"/stax/publisher/drafts/{_segment(draft_id)}/status")

    def search_marketplace(
        self,
        *,
        search: str = "",
        item_kind: str = "all",
        item_type: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        resolved_kind = item_type or item_kind
        query_values: dict[str, Any] = {
            "source": "all",
            "limit": limit,
        }
        if search.strip():
            query_values["q"] = search.strip()
        if resolved_kind and resolved_kind != "all":
            query_values["kind"] = resolved_kind
        if offset > 0:
            query_values["cursor"] = offset
        query = urlencode(query_values)
        return self._json(
            "GET",
            f"/marketplace/items?{query}",
            token="",
            require_auth=False,
        )

    def get_marketplace_item(self, item_id: str) -> dict[str, Any]:
        return self._json(
            "GET",
            f"/stax/items/{_segment(item_id)}",
            token="",
            require_auth=False,
        )

    def get_marketplace_install_package(self, item_id: str) -> dict[str, Any]:
        return self._json("GET", f"/stax/installs/package/{_segment(item_id)}")

    def record_marketplace_install(
        self,
        item_id: str,
        version_number: int,
    ) -> dict[str, Any]:
        return self._json(
            "POST",
            "/stax/installs",
            {"item_id": item_id, "installed_version": version_number},
        )

    def download_public_package(
        self,
        download_url: str,
        *,
        max_bytes: int,
    ) -> bytes:
        parsed = urlparse(download_url)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.hostname
            or (
                parsed.scheme != "https"
                and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            )
        ):
            raise PublisherError(
                "Marketplace package URL is invalid.",
                code="invalid_download_url",
            )
        status, response_headers, body = self.transport(
            "GET",
            download_url,
            {
                "Accept": "application/zip",
                "User-Agent": PUBLISHER_USER_AGENT,
            },
            None,
            self.timeout,
        )
        if status < 200 or status >= 300:
            raise PublisherError(
                f"Marketplace package download failed with HTTP {status}.",
                code="package_download_failed",
                details={"status": status},
            )
        content_length = _header_value(response_headers, "content-length")
        if content_length:
            try:
                declared_size = int(content_length)
            except ValueError:
                declared_size = -1
            if declared_size < 0 or declared_size > max_bytes:
                raise PublisherError(
                    "Marketplace package exceeds the download size limit.",
                    code="package_too_large",
                )
        if len(body) <= 0 or len(body) > max_bytes:
            raise PublisherError(
                "Marketplace package is empty or exceeds the download size limit.",
                code="package_too_large",
            )
        return body

    def _json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        token: str | None = None,
        require_auth: bool = True,
    ) -> dict[str, Any]:
        request_token = self.token if token is None else str(token).strip()
        if require_auth and not request_token:
            raise PublisherError(
                "Taku login is required on this device. Sign in to Taku, then rerun the command; do not paste tokens into chat.",
                code="missing_auth",
            )
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "User-Agent": PUBLISHER_USER_AGENT,
            "X-Taku-Publisher-Schema": SCHEMA_VERSION,
        }
        if request_token:
            headers["Authorization"] = f"Bearer {request_token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
        status, response_headers, response_body = self.transport(
            method,
            f"{self.worker_url}{path}",
            headers,
            body,
            self.timeout,
        )
        parsed = _parse_json_response(response_body)
        if status < 200 or status >= 300:
            message = parsed.get("error") or parsed.get("message") or f"HTTP {status}"
            response_preview = _body_preview(response_body)
            if request_token:
                message = str(message).replace(request_token, "[REDACTED]")
                response_preview = response_preview.replace(request_token, "[REDACTED]")
            details = {
                "status": status,
                "path": path,
                "server": _header_value(response_headers, "server"),
                "content_type": _header_value(response_headers, "content-type"),
                "cf_ray": _header_value(response_headers, "cf-ray"),
            }
            if response_preview:
                details["response_preview"] = response_preview
            raise PublisherError(str(message), code="api_error", details=details)
        return parsed


def draft_create_payload(state: dict[str, Any]) -> dict[str, Any]:
    unit = state.get("unit") or {}
    children = unit.get("children") if isinstance(unit.get("children"), list) else []
    tool_type = unit.get("type")
    tool_name = str(unit.get("name") or unit.get("id") or "").strip()
    description = str(unit.get("description") or "").strip()
    generated_listing: dict[str, Any] = {
        "title": tool_name,
        "sourceKind": "local_upload",
        "authorshipKind": "original",
        "rightsBasis": "self_owned",
        "categories": [DEFAULT_MARKETPLACE_CATEGORY],
        "description": _default_listing_description(tool_name, description, tool_type),
        "examples": _default_listing_examples(tool_name, tool_type),
        "platforms": list(SUPPORTED_RUNTIME_PLATFORMS),
        **(_inferred_source_and_support_listing(state)),
        **(_inferred_license_listing(state)),
        **({"shortDescription": description[:500]} if description else {}),
    }
    is_update = state.get("mode") == "update"
    payload: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "mode": state.get("mode"),
        "toolType": tool_type,
        "tool": {
            "id": unit.get("id"),
            "type": tool_type,
            "name": tool_name,
            "description": description[:2000],
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
        },
        # Update drafts inherit their public listing from the server-owned item.
        # Only metadata explicitly merged by remote-create may override it.
        "listing": {} if is_update else generated_listing,
    }
    if state.get("stage_sha256"):
        payload["localArtifact"] = {
            "stageSha256": state.get("stage_sha256"),
            "fileCount": state.get("file_count"),
            "totalBytes": state.get("total_bytes"),
        }
    if is_update:
        item_id = str(state.get("item_id") or "").strip()
        if not item_id:
            raise PublisherError("Update mode requires itemId.", code="missing_item_id")
        payload["itemId"] = item_id
        payload["inheritListing"] = True
    return payload


def normalize_listing_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    return {LISTING_KEY_ALIASES.get(key, key): value for key, value in metadata.items()}


def _default_listing_description(name: str, description: str, tool_type: str | None) -> str:
    title = str(name or "This local Taku tool").strip()
    summary = str(description or "").strip()
    kind = str(tool_type or "tool").strip() or "tool"
    lines = [
        f"## {title}",
        "",
    ]
    if summary:
        lines.extend([summary, ""])
    lines.extend([
        "### Capabilities",
        f"- Packages this local {kind} for installation through Taku.",
        "- Includes the selected source files after local staging exclusions.",
        "- Declares configuration requirements so users can provide values securely after installation.",
        "",
        "### Setup",
        "- Install from Taku, then review any listed environment variables or secrets.",
        "- Follow the bundled README or SKILL.md for tool-specific usage instructions.",
        "",
        "### Safety",
        "- Secret files, local credential stores, caches, build output, and VCS metadata are excluded from the package.",
        "- The package is scanned locally before upload and verified by Taku before release.",
    ])
    return "\n".join(lines)


def _default_listing_examples(name: str, tool_type: str | None) -> list[str]:
    title = str(name or "this tool").strip()
    kind = str(tool_type or "tool").strip() or "tool"
    return [
        f"Install {title} from Taku, configure any required secrets, then use the bundled {kind} instructions.",
        "Review README.md or SKILL.md in the package for setup, inputs, outputs, and limitations.",
    ]


def _inferred_license_listing(state: dict[str, Any]) -> dict[str, str]:
    root = _source_root(state)
    if not root:
        return {}
    license_value = _infer_license(root)
    return {"license": license_value} if license_value else {}


def _inferred_source_and_support_listing(state: dict[str, Any]) -> dict[str, str]:
    root = _source_root(state)
    if not root:
        return {}
    package_json = _read_json_object(root / "package.json")
    if not package_json:
        return {}
    listing: dict[str, str] = {}
    repository = package_json.get("repository")
    bugs = package_json.get("bugs")
    support = package_json.get("support")
    urls = package_json.get("urls")
    source_url = _public_source_url(_first_string(
        repository,
        repository.get("url") if isinstance(repository, dict) else None,
        package_json.get("homepage"),
        bugs.get("url") if isinstance(bugs, dict) else None,
    ))
    if source_url:
        listing["sourceUrl"] = source_url
    support_email = _email_string(_first_string(
        bugs.get("email") if isinstance(bugs, dict) else None,
        support.get("email") if isinstance(support, dict) else None,
    ))
    if support_email:
        listing["supportEmail"] = support_email
    privacy_policy_url = _public_source_url(_first_string(
        package_json.get("privacyPolicyUrl"),
        package_json.get("privacyPolicy"),
        package_json.get("privacy"),
        urls.get("privacy") if isinstance(urls, dict) else None,
    ))
    if privacy_policy_url:
        listing["privacyPolicyUrl"] = privacy_policy_url
    license_value = _first_string(package_json.get("license"))
    if license_value:
        listing["license"] = license_value[:100]
    return listing


def _source_root(state: dict[str, Any]) -> Path | None:
    source_path = str(state.get("source_path") or "").strip()
    if not source_path:
        return None
    source = Path(source_path).expanduser()
    try:
        root = source if source.is_dir() else source.parent
    except OSError:
        return None
    return root if root.exists() else None


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _email_string(value: str) -> str:
    return value if re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", value) else ""


def _public_source_url(value: str) -> str:
    raw = value.strip()
    if not raw:
        return ""
    raw = re.sub(r"^git\+", "", raw)
    raw = re.sub(r"\.git$", "", raw, flags=re.IGNORECASE)
    ssh = re.match(r"^git@github\.com:([^/]+/[^/]+)$", raw, flags=re.IGNORECASE)
    if ssh:
        raw = f"https://github.com/{ssh.group(1)}"
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        return ""
    return raw


def _infer_license(root: Path) -> str | None:
    for file_name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md", "COPYING.txt"):
        path = root / file_name
        if not path.is_file():
            continue
        detected = _license_from_text(_read_small_text(path))
        if detected:
            return detected
    for file_name in ("README.md", "README.markdown", "README.txt", "README"):
        path = root / file_name
        if not path.is_file():
            continue
        detected = _license_from_readme(_read_small_text(path))
        if detected:
            return detected
    return None


def _read_small_text(path: Path, limit: int = 64_000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:limit]
    except OSError:
        return ""


def _license_from_readme(text: str) -> str | None:
    match = re.search(r"(?im)^#{1,4}\s+license\s*$", text)
    if not match:
        return None
    section = text[match.end():]
    next_heading = re.search(r"(?m)^#{1,4}\s+\S+", section)
    if next_heading:
        section = section[:next_heading.start()]
    return _license_from_text(section)


def _license_from_text(text: str) -> str | None:
    normalized = text.lower()
    patterns = (
        ("Apache-2.0", (r"apache license", r"apache-?2\.0")),
        ("MIT", (r"\bmit license\b", r"permission is hereby granted", r"^mit\b")),
        ("BSD-3-Clause", (r"bsd 3-clause", r"redistribution and use in source and binary forms")),
        ("BSD-2-Clause", (r"bsd 2-clause",)),
        ("GPL-3.0", (r"gnu general public license", r"\bgpl-?3")),
        ("LGPL-3.0", (r"gnu lesser general public license", r"\blgpl-?3")),
        ("AGPL-3.0", (r"gnu affero general public license", r"\bagpl-?3")),
        ("MPL-2.0", (r"mozilla public license", r"\bmpl-?2\.0")),
        ("ISC", (r"\bisc license\b",)),
        ("Unlicense", (r"\bthe unlicense\b",)),
    )
    for license_name, expressions in patterns:
        if any(re.search(expression, normalized, flags=re.MULTILINE) for expression in expressions):
            return license_name
    return None


def extract_remote_id(response: dict[str, Any], *keys: str) -> str:
    for candidate in _response_candidates(response):
        for key in keys:
            value = candidate.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise PublisherError(f"Platform response did not include any of: {', '.join(keys)}", code="invalid_api_response")


def extract_draft_listing(response: dict[str, Any]) -> dict[str, Any] | None:
    for candidate in response_candidates(response):
        listing = candidate.get("listing")
        if isinstance(listing, dict):
            return normalize_listing_metadata(listing)
    return None


def response_candidates(response: dict[str, Any]) -> list[dict[str, Any]]:
    return _response_candidates(response)


def _response_candidates(response: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [response]
    for key in ("data", "artifact", "upload", "draft", "submission", "icon"):
        value = response.get(key)
        if not isinstance(value, dict):
            continue
        candidates.append(value)
        for nested_key in ("artifact", "upload", "draft", "submission", "icon"):
            nested = value.get(nested_key)
            if isinstance(nested, dict):
                candidates.append(nested)
    return candidates


def _validate_worker_url(value: str, allow_custom: bool) -> str:
    normalized = str(value or DEFAULT_WORKER_URL).strip()
    parsed = urlparse(normalized)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
        raise PublisherError("Worker URL must be a plain HTTP(S) origin.", code="invalid_worker_url")
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    default_host = urlparse(DEFAULT_WORKER_URL).hostname
    if parsed.scheme != "https" and not loopback:
        raise PublisherError("Non-loopback Worker URLs must use HTTPS.", code="unsafe_worker_url")
    if parsed.hostname != default_host and not loopback and not allow_custom:
        raise PublisherError(
            "Refusing to send Taku auth to a custom Worker host without explicit opt-in.",
            code="custom_worker_not_allowed",
        )
    return normalized.rstrip("/")


def _segment(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized or any(character in normalized for character in "/?#"):
        raise PublisherError("Invalid API resource ID.", code="invalid_resource_id")
    from urllib.parse import quote

    return quote(normalized, safe="")


def _parse_json_response(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PublisherError(f"Expected JSON response, got: {_body_preview(body)}", code="invalid_api_response") from error
    if not isinstance(parsed, dict):
        raise PublisherError("Expected a JSON object from Taku API.", code="invalid_api_response")
    return parsed


def _body_preview(body: bytes) -> str:
    return body[:200].decode("utf-8", errors="replace").replace("\n", " ").strip()


def _header_value(headers: dict[str, str], name: str) -> str | None:
    target = name.lower()
    for header, value in headers.items():
        if header.lower() == target:
            return value
    return None


def _default_transport(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout: float,
) -> tuple[int, dict[str, str], bytes]:
    current_url = url
    for _ in range(4):
        request = urllib.request.Request(current_url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, dict(response.headers.items()), response.read()
        except urllib.error.HTTPError as error:
            response_headers = dict(error.headers.items())
            if error.code in {307, 308}:
                location = _header_value(response_headers, "location")
                if location:
                    current_url = urljoin(current_url, location)
                    continue
            return error.code, response_headers, error.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise PublisherError(
                "Network request failed.",
                code="network_error",
                details=_network_error_details(current_url, error),
            ) from error
    raise PublisherError("Network redirect loop while contacting Taku.", code="network_redirect_loop")


def _network_error_details(url: str, error: BaseException) -> dict[str, Any]:
    parsed = urlparse(url)
    reason = getattr(error, "reason", error)
    proxy_names = sorted(
        name for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "all_proxy")
        if os.environ.get(name)
    )
    return {
        "host": parsed.hostname,
        "reason_type": type(reason).__name__,
        "reason": str(reason)[:300],
        "proxy_env_present": proxy_names,
    }
