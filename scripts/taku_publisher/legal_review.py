from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import urlencode, urlparse

from .browser_auth import DEFAULT_SITE_URL
from .util import PublisherError, json_output

LEGAL_CODES = {"REGISTRATION_REQUIRED", "LEGAL_ACCEPTANCE_REQUIRED", "PUBLISHER_LEGAL_REVIEW_REQUIRED"}
DOCUMENTS = ("service", "publisher", "marketplace")


def legal_review_action(status: int, data: Any, api_path: str = "", site_url: str | None = None) -> dict[str, Any] | None:
    if status != 428 or not isinstance(data, dict) or not isinstance(data.get("error"), str) or data["error"] not in LEGAL_CODES:
        return None
    site = urlparse(site_url or os.environ.get("TAKU_SITE_URL") or DEFAULT_SITE_URL)
    local = site.hostname in ("localhost", "127.0.0.1", "::1")
    if not site.hostname or site.username or site.password or (site.scheme != "https" and not (site.scheme == "http" and local)):
        raise PublisherError("Configure a trusted HTTPS Taku site URL (or loopback for local testing).", code="invalid_site_url")
    documents = [value for value in DOCUMENTS if isinstance(data.get("documents"), list) and value in data["documents"]]
    artifact_review = data["error"] == "PUBLISHER_LEGAL_REVIEW_REQUIRED"
    draft = re.fullmatch(r"/stax/publisher/drafts/([A-Za-z0-9_-]+)/submit", api_path)
    review_path = f"/publish/{draft[1]}" if artifact_review and draft else "/legal/accept"
    if not artifact_review and documents:
        review_path += "?" + urlencode({"documents": ",".join(documents)})
    message = (
        "Open the saved draft in Taku Web with the same account. Review the current artifact, Publisher Terms, and distribution license there. Return here to check its status; do not resubmit it automatically."
        if artifact_review else
        "Open the review URL, sign in with the same Taku account, and complete registration or review the required terms yourself. Then return here to continue the interrupted command. Your local draft has been kept."
    )
    return {
        "ok": False, "status": "legal_review_required", "requires_action": True,
        "action_type": "review_legal_terms", "needsAuth": False, "legal_code": data["error"],
        "http_status": status, "review_url": f"{site.scheme}://{site.netloc}{review_path}",
        "documents": documents, "message": message,
    }


def publisher_error_output(error: PublisherError) -> dict[str, Any]:
    action = error.details if error.code == "legal_review_required" else {}
    output = json_output(ok=False, status="error")
    output.update(action)
    output["error"] = {"code": error.code, "message": str(error), "details": error.details}
    return output
