from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .constants import publisher_home
from .util import atomic_write_json


TAKU_ACCOUNT_BASE_URL = "https://auth.taku.ai"
SUPABASE_PUBLIC_CLIENT_VALUE = "sb_publishable_" + "CU6CXli0rTJmPMUjZbRJVQ_9ebw7OvV"
REFRESH_BUFFER_MS = 5 * 60 * 1000
DEFAULT_EXPIRES_IN_SECONDS = 3600

RefreshTransport = Callable[[str, dict[str, str], bytes, float], tuple[int, bytes]]


@dataclass(frozen=True)
class ResolvedAuth:
    token: str
    source: str
    icon_token: str = ""
    scopes: tuple[str, ...] = ()
    session_path: Path | None = None
    refreshed: bool = False


def resolve_auth_token(*, token_env: str = "TAKU_BEARER_TOKEN") -> str:
    return resolve_auth(token_env=token_env).token


def resolve_auth(
    *,
    token_env: str = "TAKU_BEARER_TOKEN",
    transport: RefreshTransport | None = None,
) -> ResolvedAuth:
    env_token = os.environ.get(token_env, "").strip()
    if env_token:
        return ResolvedAuth(
            token=env_token,
            icon_token="" if env_token.startswith("taku_pub_") else env_token,
            source=f"env:{token_env}",
        )
    if token_env == "TAKU_BEARER_TOKEN":
        fallback_token = os.environ.get("TAKU_PUBLISH_TOKEN", "").strip()
        if fallback_token:
            return ResolvedAuth(
                token=fallback_token,
                icon_token="" if fallback_token.startswith("taku_pub_") else fallback_token,
                source="env:TAKU_PUBLISH_TOKEN",
            )

    publisher_path = publisher_session_path()
    publisher_session = read_session(publisher_path)
    if publisher_session and not _is_expired(publisher_session):
        return ResolvedAuth(
            token=str(publisher_session.get("accessToken") or "").strip(),
            icon_token=_valid_icon_token(publisher_session),
            scopes=tuple(
                str(scope)
                for scope in publisher_session.get("scopes", [])
                if isinstance(scope, str) and scope.strip()
            ),
            source="publisher_session",
            session_path=publisher_path,
        )

    path = session_path()
    session = read_session(path)
    if not session:
        return ResolvedAuth(token="", source="missing", session_path=path)

    access_token = str(session.get("accessToken") or "").strip()
    if access_token and not _is_expiring(session):
        return ResolvedAuth(token=access_token, icon_token=access_token, source="session", session_path=path)

    refreshed = refresh_session(session, path=path, transport=transport)
    if refreshed:
        refreshed_token = str(refreshed.get("accessToken") or "").strip()
        if refreshed_token:
            return ResolvedAuth(
                token=refreshed_token,
                icon_token=refreshed_token,
                source="session",
                session_path=path,
                refreshed=True,
            )

    if access_token and _expires_at_ms(session) is None:
        return ResolvedAuth(token=access_token, icon_token=access_token, source="session", session_path=path)
    return ResolvedAuth(token="", source="expired", session_path=path)


def auth_status(
    *,
    token_env: str = "TAKU_BEARER_TOKEN",
    refresh: bool = False,
    transport: RefreshTransport | None = None,
) -> dict[str, Any]:
    path = session_path()
    session = read_session(path)
    if refresh and session:
        refreshed = refresh_session(session, path=path, transport=transport)
        if refreshed:
            session = refreshed
    resolved = resolve_auth(token_env=token_env, transport=transport)
    if session is None:
        session = read_session(path)

    effective_session = (
        read_session(publisher_session_path())
        if resolved.source == "publisher_session"
        else session
    )
    expires_at = _expires_at_ms(effective_session or {})
    expires_in_seconds = None
    if expires_at is not None:
        expires_in_seconds = max(0, int((expires_at - int(time.time() * 1000)) / 1000))

    return {
        "authenticated": bool(resolved.token),
        "source": resolved.source,
        "account_hint": publisher_account_hint(
            session=session,
            token_env=token_env,
            auth_source=resolved.source,
        ),
        "session_path": str(path),
        "session_file_exists": path.exists(),
        "publisher_session_path": str(publisher_session_path()),
        "publisher_session_file_exists": publisher_session_path().exists(),
        "can_refresh": bool((session or {}).get("refreshToken")),
        "refreshed": resolved.refreshed,
        "expires_in_seconds": expires_in_seconds,
    }


def publisher_account_hint(
    *,
    session: dict[str, Any] | None = None,
    path: Path | None = None,
    token_env: str = "TAKU_BEARER_TOKEN",
    auth_source: str | None = None,
) -> str | None:
    if auth_source is not None and auth_source not in {"session", "publisher_session"}:
        return None
    if os.environ.get(token_env, "").strip():
        return None
    if token_env == "TAKU_BEARER_TOKEN" and os.environ.get("TAKU_PUBLISH_TOKEN", "").strip():
        return None
    if auth_source == "publisher_session":
        current = read_session(publisher_session_path())
        hint = str((current or {}).get("accountHint") or "").strip()
        if hint:
            return hint
    else:
        current = session if session is not None else read_session(path)
    user = current.get("user") if isinstance(current, dict) else None
    email = str(user.get("email") or "").strip() if isinstance(user, dict) else ""
    if "@" not in email:
        return None
    local, domain = email.rsplit("@", 1)
    if not local or not domain:
        return None
    visible = local[: min(4, max(1, len(local) // 2))]
    return f"{visible}***@{domain}"


def session_path() -> Path:
    explicit = os.environ.get("TAKU_SESSION_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    home = os.environ.get("TAKU_HOME", "").strip()
    if home:
        return (Path(home).expanduser().resolve() / "session.json")
    return Path.home() / ".taku" / "session.json"


def publisher_session_path() -> Path:
    explicit = os.environ.get("TAKU_PUBLISHER_SESSION_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    return publisher_home() / "session.json"


def save_publisher_session(payload: dict[str, Any]) -> Path:
    path = publisher_session_path()
    atomic_write_json(path, payload, mode=0o600)
    return path


def clear_publisher_session() -> bool:
    path = publisher_session_path()
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def auth_has_scope(auth: ResolvedAuth, scope: str) -> bool:
    return bool(auth.token) and (
        auth.source != "publisher_session" or scope in auth.scopes
    )


def read_session(path: Path | None = None) -> dict[str, Any] | None:
    target = path or session_path()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def refresh_session(
    session: dict[str, Any],
    *,
    path: Path | None = None,
    transport: RefreshTransport | None = None,
    timeout: float = 15.0,
) -> dict[str, Any] | None:
    refresh_token = str(session.get("refreshToken") or "").strip()
    if not refresh_token:
        return None
    request_body = json.dumps({"refresh_token": refresh_token}, separators=(",", ":")).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "".join(("api", "key")): SUPABASE_PUBLIC_CLIENT_VALUE,
    }
    try:
        status, response_body = (transport or _default_refresh_transport)(
            f"{TAKU_ACCOUNT_BASE_URL}/auth/v1/token?grant_type=refresh_token",
            headers,
            request_body,
            timeout,
        )
    except (OSError, urllib.error.URLError, TimeoutError):
        return None
    if status < 200 or status >= 300:
        return None
    try:
        payload = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        return None

    expires_in = _positive_int(payload.get("expires_in"), DEFAULT_EXPIRES_IN_SECONDS)
    updated = dict(session)
    updated["accessToken"] = access_token
    updated["refreshToken"] = str(payload.get("refresh_token") or refresh_token)
    updated["expiresAt"] = int(time.time() * 1000) + expires_in * 1000
    if isinstance(payload.get("user"), dict):
        updated["user"] = payload["user"]
    atomic_write_json(path or session_path(), updated, mode=0o600)
    return updated


def _default_refresh_transport(url: str, headers: dict[str, str], body: bytes, timeout: float) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return int(response.status), response.read()


def _is_expiring(session: dict[str, Any]) -> bool:
    expires_at = _expires_at_ms(session)
    if expires_at is None:
        return False
    return expires_at <= int(time.time() * 1000) + REFRESH_BUFFER_MS


def _is_expired(session: dict[str, Any]) -> bool:
    token = str(session.get("accessToken") or "").strip()
    expires_at = _expires_at_ms(session)
    return not token or expires_at is None or expires_at <= int(time.time() * 1000) + 30_000


def _valid_icon_token(session: dict[str, Any]) -> str:
    token = str(session.get("iconToken") or "").strip()
    try:
        expires_at = int(float(session.get("iconExpiresAt") or 0))
    except (TypeError, ValueError):
        return ""
    return token if expires_at > int(time.time() * 1000) + 5_000 else ""


def _expires_at_ms(session: dict[str, Any]) -> int | None:
    value = session.get("expiresAt")
    try:
        numeric = int(float(value))
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        return None
    if numeric < 10_000_000_000:
        return numeric * 1000
    return numeric


def _positive_int(value: Any, default: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return default
    return numeric if numeric > 0 else default
