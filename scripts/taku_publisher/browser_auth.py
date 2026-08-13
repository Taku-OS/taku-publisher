from __future__ import annotations

import base64
import hashlib
import json
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from .auth import auth_status, save_publisher_session
from .util import PublisherError


DEFAULT_SITE_URL = "https://taku.ai"
DEFAULT_LOGIN_TIMEOUT_SECONDS = 5 * 60
LOOPBACK_HOST = ".".join(("127", "0", "0", "1"))


def login_with_browser(
    *,
    worker_url: str,
    site_url: str = DEFAULT_SITE_URL,
    intent: str = "publish_tool",
    timeout: float = DEFAULT_LOGIN_TIMEOUT_SECONDS,
    open_browser: bool = True,
    browser_open: Callable[[str], bool] | None = None,
) -> dict[str, Any]:
    state = _base64url(secrets.token_bytes(24))
    code_verifier = _base64url(secrets.token_bytes(32))
    code_challenge = _base64url(hashlib.sha256(code_verifier.encode("ascii")).digest())
    callback: dict[str, str] = {}
    callback_received = threading.Event()

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if urllib.parse.urlparse(self.path).path != "/callback":
                self.send_error(404)
                return
            body = _callback_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802
            if urllib.parse.urlparse(self.path).path != "/callback":
                self.send_error(404)
                return
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 16_384)
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                self._json_response(400, {"ok": False, "error": "Invalid callback"})
                return
            code = str(body.get("code") or "").strip() if isinstance(body, dict) else ""
            returned_state = str(body.get("state") or "").strip() if isinstance(body, dict) else ""
            if not code or not secrets.compare_digest(returned_state, state):
                self._json_response(401, {"ok": False, "error": "Authorization state mismatch"})
                return
            callback.update({"code": code, "state": returned_state})
            callback_received.set()
            self._json_response(200, {"ok": True})

        def _json_response(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer((LOOPBACK_HOST, 0), CallbackHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return_to = f"{'http'}://{LOOPBACK_HOST}:{server.server_port}/callback"
    login_url = _login_url(
        site_url=site_url,
        return_to=return_to,
        intent=intent,
        worker_url=worker_url,
        state=state,
        code_challenge=code_challenge,
    )

    print(f"Open this Taku authorization page if the browser did not open:\n{login_url}", file=sys.stderr, flush=True)
    if open_browser:
        (browser_open or webbrowser.open)(login_url)

    try:
        if not callback_received.wait(timeout=max(1.0, timeout)):
            raise PublisherError(
                "Taku Web authorization timed out. Run auth-login to try again.",
                code="auth_timeout",
                details={"login_url": login_url},
            )
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)

    payload = _redeem_local_code(
        worker_url=worker_url,
        code=callback["code"],
        state=callback["state"],
        code_verifier=code_verifier,
        intent=intent,
        timeout=min(max(timeout, 5.0), 30.0),
    )
    access_token = str(payload.get("token") or "").strip()
    if not access_token:
        raise PublisherError("Taku Web did not return a publisher authorization.", code="invalid_auth_response")

    now = int(time.time() * 1000)
    expires_in = _positive_int(payload.get("expiresIn"), 3600)
    icon_expires_in = _positive_int(payload.get("iconTokenExpiresIn"), 0)
    save_publisher_session({
        "schemaVersion": "taku.publisher.session.v1",
        "accessToken": access_token,
        "expiresAt": now + expires_in * 1000,
        "iconToken": str(payload.get("iconToken") or "").strip(),
        "iconExpiresAt": now + icon_expires_in * 1000,
        "scopes": payload.get("scopes") if isinstance(payload.get("scopes"), list) else [],
        "accountHint": str(payload.get("accountHint") or "").strip() or None,
        "createdAt": now,
    })
    return auth_status()


def _login_url(
    *,
    site_url: str,
    return_to: str,
    intent: str,
    worker_url: str,
    state: str,
    code_challenge: str,
) -> str:
    query = urllib.parse.urlencode({
        "source": "taku_creator",
        "intent": intent,
        "worker_url": worker_url.rstrip("/"),
        "return_to": return_to,
        "auth_flow": "local_code",
        "auth_state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    })
    return f"{site_url.rstrip('/')}/profile?{query}"


def _redeem_local_code(
    *,
    worker_url: str,
    code: str,
    state: str,
    code_verifier: str,
    intent: str,
    timeout: float,
) -> dict[str, Any]:
    body = json.dumps({
        "code": code,
        "state": state,
        "codeVerifier": code_verifier,
        "intent": intent,
    }, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{worker_url.rstrip('/')}/marketplace/local-auth/redeem",
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read()
            status = int(response.status)
    except urllib.error.HTTPError as error:
        response_body = error.read()
        status = int(error.code)
    except (OSError, urllib.error.URLError, TimeoutError) as error:
        raise PublisherError("Unable to redeem Taku Web authorization.", code="auth_network_error") from error
    try:
        payload = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PublisherError("Taku Web returned an invalid authorization response.", code="invalid_auth_response") from error
    if status < 200 or status >= 300 or not isinstance(payload, dict):
        message = payload.get("error") if isinstance(payload, dict) else None
        raise PublisherError(str(message or f"Authorization failed with HTTP {status}"), code="auth_redeem_failed")
    return payload


def _callback_html() -> str:
    return """<!doctype html><html><head><meta charset=\"utf-8\"><title>Taku Publisher</title></head>
<body><p id=\"status\">Completing Taku Publisher authorization...</p><script>
(async()=>{const p=new URLSearchParams(location.hash.slice(1));const code=p.get('taku_auth_code')||'';
const state=p.get('taku_auth_state')||'';const el=document.getElementById('status');
try{const r=await fetch('/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,state})});
if(!r.ok)throw new Error('Authorization failed');history.replaceState(null,'',location.pathname);el.textContent='Taku Publisher is authorized. You can close this tab.';}
catch(e){el.textContent='Authorization could not be completed. Return to the terminal and try again.';}})();
</script></body></html>"""


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _positive_int(value: Any, default: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return default
    return numeric if numeric > 0 else default
