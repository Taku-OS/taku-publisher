from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .constants import MAX_TEXT_SCAN_BYTES, SCHEMA_VERSION
from .util import PublisherError, atomic_write_json, read_json, save_state
from .workspace import assert_stage_unchanged


PLACEHOLDER_PATTERN = re.compile(
    r"(?:change[-_ ]?me|example|fake|fixture|placeholder|replace[-_ ]?me|sample|test|xxx+|your[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)|<[^>]+>|\$\{[A-Z][A-Z0-9_]+\})",
    re.IGNORECASE,
)
ENV_REFERENCE_PATTERN = re.compile(
    r"(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv\s*\(|ENV\s*\[|os\.Getenv)",
    re.IGNORECASE,
)
SECRET_NAME_PATTERN = re.compile(
    r"(?:api[_-]?key|access[_-]?key|auth(?:orization)?|bearer|client[_-]?secret|credential|password|passwd|private[_-]?key|secret|session|token)",
    re.IGNORECASE,
)
KNOWN_TOKEN_PATTERN = re.compile(
    r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,})\b"
)
PRIVATE_KEY_PATTERN = re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")
BEARER_PATTERN = re.compile(r"\bBearer\s+([A-Za-z0-9._~+/=-]{16,})\b", re.IGNORECASE)
DATABASE_URL_PATTERN = re.compile(
    r"\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[^\s:/@]+:([^\s/@]+)@",
    re.IGNORECASE,
)
ABSOLUTE_PATH_PATTERNS = (
    re.compile(r"(?:^|[\s\"'`(])(?:/Users|/home|/private/var/folders|/var/folders|/Volumes)/[^\s\"'`)]+"),
    re.compile(r"[A-Za-z]:\\(?:Users|Documents and Settings)\\", re.IGNORECASE),
    re.compile(r"file:///", re.IGNORECASE),
)
PRIVATE_URL_PATTERN = re.compile(
    r"https?://(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[[fF][eE]80:[^\]]+\]|[^/\s\"'`]+\.(?:local|internal))(?:[:/?#\s\"'`)]|$)",
    re.IGNORECASE,
)
LOOPBACK_URL_PATTERN = re.compile(
    r"https?://(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?:[:/?#\s\"'`)]|$)",
    re.IGNORECASE,
)
NON_LOOPBACK_PRIVATE_URL_PATTERN = re.compile(
    r"https?://(?:0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[[fF][eE]80:[^\]]+\]|[^/\s\"'`]+\.(?:local|internal))(?:[:/?#\s\"'`)]|$)",
    re.IGNORECASE,
)
CREDENTIAL_ASSIGNMENT_PATTERN = re.compile(
    r"\b([A-Za-z][A-Za-z0-9_.-]*)\b\s*[:=]\s*(.+)$",
    re.IGNORECASE,
)
MAX_SCAN_FINDINGS = 500

RISK_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    (
        "dangerous_command",
        "Potentially destructive or privilege-changing command requires semantic review.",
        re.compile(r"(?:\brm\s+-[rf]{1,2}\b|\bsudo\b|\bchmod\s+(?:777|a\+rwx)\b|\bchown\s+-R\b|\bmkfs\b|\bdd\s+if=)", re.IGNORECASE),
    ),
    (
        "shell_download_execution",
        "Downloaded content or dynamic text may be executed by a shell.",
        re.compile(r"(?:curl|wget)[^\n|;]*(?:\||;|&&)\s*(?:ba)?sh\b", re.IGNORECASE),
    ),
    (
        "process_execution",
        "The tool launches a process or shell command and needs argument-flow review.",
        re.compile(r"(?:child_process\.(?:exec|execSync|spawn)|subprocess\.(?:run|Popen|call)|os\.system\s*\(|Runtime\.getRuntime\(\)\.exec|Command::new\s*\()"),
    ),
    (
        "dynamic_code_execution",
        "Dynamic code evaluation needs input provenance review.",
        re.compile(r"(?:\beval\s*\(|\bnew\s+Function\s*\(|\bexec\s*\()"),
    ),
    (
        "network_access",
        "Outbound network access needs endpoint and data-flow review.",
        re.compile(r"(?:\bfetch\s*\(|axios\.|requests\.(?:get|post|put|patch|delete)|urllib\.request|httpx\.|https?\.request\s*\(|net\.Dial\s*\(|WebSocket\s*\()"),
    ),
    (
        "broad_filesystem_access",
        "Broad filesystem access needs scope and purpose review.",
        re.compile(r"(?:readFile|writeFile|readdir|read_text|write_text|open\s*\(|os\.walk\s*\(|glob\s*\(|Path\.home\s*\()"),
    ),
    (
        "broad_permission",
        "A broad permission declaration needs least-privilege review.",
        re.compile(r"(?:\"permissions\"\s*:\s*\[?\s*\"?\*|--privileged\b|hostNetwork\s*:\s*true|allowDangerouslySkipPermissions)", re.IGNORECASE),
    ),
)

SECRET_ENV_NAME_PATTERN = re.compile(
    r"(?:API_KEY|ACCESS_KEY|AUTH|BEARER|CLIENT_SECRET|CREDENTIAL|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|SESSION|TOKEN)(?:_|$)",
    re.IGNORECASE,
)

REQUIREMENT_PATTERNS: tuple[tuple[re.Pattern[str], bool], ...] = (
    (re.compile(r"\bos\.environ\s*\[\s*[\"']([A-Z][A-Z0-9_]*)[\"']\s*\]"), True),
    (re.compile(r"\bENV\s*\[\s*[\"']([A-Z][A-Z0-9_]*)[\"']\s*\]"), True),
    (re.compile(r"\b(?:requireEnv|getRequiredEnv|mustGetEnv)\s*\(\s*[\"']([A-Z][A-Z0-9_]*)[\"']"), True),
    (re.compile(r"\bprocess\.env\.([A-Z][A-Z0-9_]*)\b"), False),
    (re.compile(r"\bprocess\.env\s*\[\s*[\"']([A-Z][A-Z0-9_]*)[\"']\s*\]"), False),
    (re.compile(r"\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)\b"), False),
    (re.compile(r"\bos\.environ\.get\s*\(\s*[\"']([A-Z][A-Z0-9_]*)[\"']"), False),
    (re.compile(r"\bos\.getenv\s*\(\s*[\"']([A-Z][A-Z0-9_]*)[\"']"), False),
    (re.compile(r"(?<![.\w])getenv\s*\(\s*[\"']([A-Z][A-Z0-9_]*)[\"']"), False),
    (re.compile(r"\bos\.Getenv\s*\(\s*[\"']([A-Z][A-Z0-9_]*)[\"']"), False),
)


def scan_staging(directory: Path, state: dict[str, Any]) -> dict[str, Any]:
    manifest = assert_stage_unchanged(directory, state)
    staging = directory / "staging"
    findings: list[dict[str, Any]] = []
    requirements: dict[str, dict[str, Any]] = {}
    review_files: list[dict[str, Any]] = []

    for entry in manifest["files"]:
        relative = entry["path"]
        file_path = staging / relative
        if not _is_text_file(file_path, entry["size"]):
            continue
        text = _read_text(file_path)
        if text is None:
            continue
        review_files.append({"path": relative, "sha256": entry["sha256"], "size": entry["size"]})
        _scan_text(relative, text, findings)
        _extract_requirements(relative, text, requirements)
        if _is_env_template(file_path.name):
            _extract_env_template_requirements(relative, text, requirements)

    findings = _bounded_findings(findings)

    requirement_list = sorted(requirements.values(), key=lambda item: (item["kind"], item["name"]))
    blocking = [finding for finding in findings if finding["severity"] == "block"]
    review = [finding for finding in findings if finding["severity"] == "review"]
    report = {
        "schema_version": SCHEMA_VERSION,
        "stage_sha256": manifest["stage_sha256"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "blocking": len(blocking),
            "review_required": len(review),
            "text_files_reviewed": len(review_files),
        },
        "findings": findings,
        "deep_scan": {
            "required": True,
            "completed": False,
            "blocked": False,
        },
    }
    requirements_document = {
        "schema_version": SCHEMA_VERSION,
        "stage_sha256": manifest["stage_sha256"],
        "secrets": [item for item in requirement_list if item["kind"] == "secret"],
        "env": [item for item in requirement_list if item["kind"] == "env"],
    }
    deep_request = {
        "schema_version": SCHEMA_VERSION,
        "stage_sha256": manifest["stage_sha256"],
        "instructions": [
            "Review every listed text file for semantic secret use, data exfiltration, unsafe execution, excessive permissions, and undeclared configuration.",
            "Resolve every generated finding and record any additional semantic finding.",
            "Never copy a real credential value into the dispositions file.",
        ],
        "generated_findings": review,
        "review_files": review_files,
        "requirements": requirement_list,
    }
    disposition_template = {
        "schema_version": SCHEMA_VERSION,
        "stage_sha256": manifest["stage_sha256"],
        "full_review_completed": False,
        "dispositions": [
            {"finding_id": finding["id"], "decision": "pending", "rationale": ""}
            for finding in review
        ],
        "additional_findings": [],
        "requirement_updates": [],
    }

    atomic_write_json(directory / "scan-report.json", report)
    atomic_write_json(directory / "requirements.json", requirements_document)
    atomic_write_json(directory / "deep-scan-request.json", deep_request)
    atomic_write_json(directory / "deep-scan-dispositions.template.json", disposition_template)
    state.update({
        "status": "deterministic_blocked" if blocking else "awaiting_deep_scan",
        "scan_summary": report["summary"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    save_state(directory, state)
    return {
        "report": report,
        "requirements": requirements_document,
        "deep_scan_request": deep_request,
        "disposition_template": disposition_template,
    }


def apply_deep_scan_dispositions(directory: Path, state: dict[str, Any], source_file: Path) -> dict[str, Any]:
    assert_stage_unchanged(directory, state)
    report = read_json(directory / "scan-report.json")
    request = read_json(directory / "deep-scan-request.json")
    dispositions = read_json(source_file.expanduser().resolve())
    if not isinstance(dispositions, dict):
        raise PublisherError("Deep-scan dispositions must be a JSON object.", code="invalid_dispositions")
    if dispositions.get("stage_sha256") != state.get("stage_sha256"):
        raise PublisherError("Dispositions do not match the immutable staging snapshot.", code="stale_dispositions")
    if dispositions.get("full_review_completed") is not True:
        raise PublisherError("Deep scan has not attested review of every listed text file.", code="deep_scan_incomplete")

    expected_ids = {finding["id"] for finding in request.get("generated_findings", [])}
    rows = dispositions.get("dispositions")
    if not isinstance(rows, list):
        raise PublisherError("Dispositions must contain a dispositions array.", code="invalid_dispositions")
    seen: set[str] = set()
    normalized_rows: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise PublisherError("Every disposition must be an object.", code="invalid_dispositions")
        finding_id = str(row.get("finding_id") or "").strip()
        decision = str(row.get("decision") or "").strip()
        rationale = _clean_rationale(row.get("rationale"))
        if finding_id not in expected_ids or finding_id in seen:
            raise PublisherError("Disposition finding IDs must exactly match generated findings.", code="invalid_dispositions")
        if decision not in {"allow", "block", "not_applicable"}:
            raise PublisherError("A disposition decision must be allow, block, or not_applicable.", code="invalid_dispositions")
        if len(rationale) < 10:
            raise PublisherError("Every disposition needs a meaningful rationale.", code="invalid_dispositions")
        _assert_no_secret_value(rationale)
        seen.add(finding_id)
        normalized_rows.append({"finding_id": finding_id, "decision": decision, "rationale": rationale})
    if seen != expected_ids:
        raise PublisherError("Every generated deep-scan finding must be resolved.", code="deep_scan_incomplete")

    additional = _normalize_additional_findings(dispositions.get("additional_findings"), directory / "staging")
    requirement_updates = _apply_requirement_updates(
        directory,
        dispositions.get("requirement_updates"),
        directory / "staging",
    )
    blocked = any(row["decision"] == "block" for row in normalized_rows) or any(
        finding["decision"] == "block" for finding in additional
    )
    deterministic_blocked = any(finding.get("severity") == "block" for finding in report.get("findings", []))
    reviewed_document = {
        "schema_version": SCHEMA_VERSION,
        "stage_sha256": state["stage_sha256"],
        "full_review_completed": True,
        "dispositions": normalized_rows,
        "additional_findings": additional,
        "requirement_updates": requirement_updates,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "blocked": blocked,
    }
    _assert_no_secret_value(json.dumps(reviewed_document, ensure_ascii=False))
    atomic_write_json(directory / "deep-scan-dispositions.json", reviewed_document)
    report["deep_scan"] = {
        "required": True,
        "completed": True,
        "blocked": blocked,
        "resolved_findings": len(normalized_rows),
        "additional_findings": len(additional),
    }
    atomic_write_json(directory / "scan-report.json", report)
    state.update({
        "status": "blocked" if blocked or deterministic_blocked else "ready_to_package",
        "deep_scan_completed": True,
        "deep_scan_blocked": blocked,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    save_state(directory, state)
    return reviewed_document


def assert_scan_ready(directory: Path, state: dict[str, Any]) -> None:
    assert_stage_unchanged(directory, state)
    report = read_json(directory / "scan-report.json")
    if any(finding.get("severity") == "block" for finding in report.get("findings", [])):
        raise PublisherError("Deterministic security findings block packaging.", code="deterministic_scan_blocked")
    deep_path = directory / "deep-scan-dispositions.json"
    if not deep_path.is_file():
        raise PublisherError("Deep scan is incomplete; apply the reviewed dispositions first.", code="deep_scan_incomplete")
    deep = read_json(deep_path)
    if deep.get("stage_sha256") != state.get("stage_sha256") or deep.get("full_review_completed") is not True:
        raise PublisherError("Deep scan is incomplete or stale.", code="deep_scan_incomplete")
    if deep.get("blocked") is True:
        raise PublisherError("Deep scan contains a blocking disposition.", code="deep_scan_blocked")


def build_platform_scan_payload(directory: Path, state: dict[str, Any]) -> dict[str, Any]:
    assert_scan_ready(directory, state)
    package_sha256 = str(state.get("bundle_sha256") or "").strip()
    if not re.fullmatch(r"[a-f0-9]{64}", package_sha256):
        raise PublisherError("Build the verified bundle before uploading scan results.", code="missing_bundle")

    report = read_json(directory / "scan-report.json")
    request = read_json(directory / "deep-scan-request.json")
    deep = read_json(directory / "deep-scan-dispositions.json")
    requirements = read_json(directory / "requirements.json")
    deterministic_findings = [
        _platform_finding(finding, disposition="review", severity="warning")
        for finding in report.get("findings", [])
        if isinstance(finding, dict) and finding.get("severity") != "block"
    ]

    generated = {
        finding.get("id"): finding
        for finding in request.get("generated_findings", [])
        if isinstance(finding, dict) and isinstance(finding.get("id"), str)
    }
    deep_findings: list[dict[str, Any]] = []
    for disposition in deep.get("dispositions", []):
        if not isinstance(disposition, dict):
            continue
        finding = generated.get(disposition.get("finding_id"))
        if not finding:
            continue
        deep_findings.append(_platform_finding(
            finding,
            disposition="allow",
            severity="warning",
            rationale=disposition.get("rationale"),
        ))
    for finding in deep.get("additional_findings", []):
        if not isinstance(finding, dict):
            continue
        deep_findings.append(_platform_finding(
            finding,
            disposition="allow",
            severity="warning",
            rationale=finding.get("rationale"),
        ))

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "packageSha256": package_sha256,
        "report": {
            "deterministic": {
                "status": "review" if deterministic_findings else "passed",
                "scanner": "taku-publisher-deterministic@1",
                "filesScanned": int(report.get("summary", {}).get("text_files_reviewed") or 0),
                "findings": deterministic_findings,
            },
            "deep": {
                "status": "passed",
                "scanner": "host-semantic-review@1",
                "findings": deep_findings,
            },
        },
        "requirements": {
            "secrets": _platform_requirements(requirements.get("secrets"), allow_default=False),
            "env": _platform_requirements(requirements.get("env"), allow_default=True),
        },
    }
    assert_public_payload(payload)
    return payload


def _platform_requirements(value: Any, *, allow_default: bool) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    output: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        normalized = {
            "name": str(item.get("name") or "").strip(),
            "purpose": str(item.get("purpose") or "").strip(),
            "required": bool(item.get("required")),
        }
        if allow_default and isinstance(item.get("default"), str) and item["default"].strip():
            normalized["default"] = item["default"].strip()
        output.append(normalized)
    return output


def _platform_finding(
    finding: dict[str, Any],
    *,
    disposition: str,
    severity: str,
    rationale: Any = None,
) -> dict[str, Any]:
    message = str(finding.get("message") or "Security review finding.").strip()
    rationale_text = str(rationale or "").strip()
    if rationale_text:
        message = f"{message} Review: {rationale_text}"
    normalized: dict[str, Any] = {
        "ruleId": str(finding.get("category") or finding.get("id") or "security-review")[:120],
        "severity": severity,
        "disposition": disposition,
        "message": message[:500],
    }
    path = str(finding.get("path") or "").strip()
    if path:
        normalized["path"] = path[:1024]
    line = finding.get("line")
    if isinstance(line, int) and line >= 1:
        normalized["line"] = line
    return normalized


def assert_public_payload(value: Any) -> None:
    serialized = json.dumps(value, ensure_ascii=False)
    _assert_no_secret_value(serialized)
    if PRIVATE_URL_PATTERN.search(serialized) or any(pattern.search(serialized) for pattern in ABSOLUTE_PATH_PATTERNS):
        raise PublisherError("Public metadata contains a local path or private-network URL.", code="private_metadata")


def _scan_text(relative: str, text: str, findings: list[dict[str, Any]]) -> None:
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not _is_pattern_definition(line):
            if PRIVATE_KEY_PATTERN.search(line):
                findings.append(_finding("private_key", "block", relative, line_number, "Private key material is not publishable.", line))
            if KNOWN_TOKEN_PATTERN.search(line):
                findings.append(_finding("known_token", "block", relative, line_number, "A value matches a known credential format.", line))
            bearer = BEARER_PATTERN.search(line)
            if bearer and not PLACEHOLDER_PATTERN.search(bearer.group(1)):
                findings.append(_finding("bearer_token", "block", relative, line_number, "A literal Bearer credential is not publishable.", line))
            database_url = DATABASE_URL_PATTERN.search(line)
            if database_url and not PLACEHOLDER_PATTERN.search(database_url.group(1)):
                findings.append(_finding("database_password_url", "block", relative, line_number, "A database URL contains embedded credentials.", line))
            if NON_LOOPBACK_PRIVATE_URL_PATTERN.search(line):
                findings.append(_finding("private_network_url", "block", relative, line_number, "A local or private-network URL is not portable or public.", line))
            if LOOPBACK_URL_PATTERN.search(line):
                findings.append(_finding("loopback_url", "review", relative, line_number, "A loopback URL requires portability review and must not appear in public metadata.", line))
            if any(pattern.search(line) for pattern in ABSOLUTE_PATH_PATTERNS):
                findings.append(_finding("local_absolute_path", "block", relative, line_number, "A machine-specific absolute path is not publishable.", line))
            assignment = CREDENTIAL_ASSIGNMENT_PATTERN.search(line)
            if assignment and _is_sensitive_credential_name(assignment.group(1)) and _looks_like_literal_secret(assignment.group(2)):
                findings.append(_finding("credential_literal", "block", relative, line_number, "A credential-like field contains a literal value.", line))
        for category, message, pattern in RISK_PATTERNS:
            if pattern.search(line):
                findings.append(_finding(category, "review", relative, line_number, message, line))


def _extract_requirements(relative: str, text: str, output: dict[str, dict[str, Any]]) -> None:
    for line_number, line in enumerate(text.splitlines(), start=1):
        for pattern, required in REQUIREMENT_PATTERNS:
            for match in pattern.finditer(line):
                _record_requirement(output, match.group(1), relative, line_number, required)


def _bounded_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(findings) <= MAX_SCAN_FINDINGS:
        return findings
    capacity = MAX_SCAN_FINDINGS - 1
    blocking = [finding for finding in findings if finding["severity"] == "block"]
    reviews = [finding for finding in findings if finding["severity"] != "block"]
    blockers_truncated = len(blocking) > capacity
    selected = blocking[:capacity]
    if not blockers_truncated:
        selected.extend(reviews[: capacity - len(selected)])
    omitted = len(findings) - len(selected)
    selected.append(_finding(
        category="finding_limit",
        severity="block" if blockers_truncated else "review",
        path=".",
        line=0,
        message=f"The scan generated {len(findings)} findings; {omitted} lower-priority findings were omitted from this bounded report.",
        excerpt="",
    ))
    return selected


def _extract_env_template_requirements(relative: str, text: str, output: dict[str, dict[str, Any]]) -> None:
    for line_number, line in enumerate(text.splitlines(), start=1):
        match = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if not match:
            continue
        value = match.group(2).strip().strip("\"'")
        if value and not PLACEHOLDER_PATTERN.search(value):
            continue
        _record_requirement(output, match.group(1), relative, line_number, not bool(value))


def _record_requirement(
    output: dict[str, dict[str, Any]],
    name: str,
    relative: str,
    line_number: int,
    required: bool,
) -> None:
    kind = "secret" if SECRET_ENV_NAME_PATTERN.search(name) else "env"
    existing = output.setdefault(name, {
        "name": name,
        "kind": kind,
        "required": required,
        "purpose": f"Used by {relative}",
        "sources": [],
    })
    existing["required"] = bool(existing["required"] or required)
    source = {"path": relative, "line": line_number}
    if source not in existing["sources"]:
        existing["sources"].append(source)


def _finding(category: str, severity: str, path: str, line: int, message: str, excerpt: str) -> dict[str, Any]:
    identifier = hashlib.sha256(f"{category}\0{severity}\0{path}\0{line}\0{message}".encode("utf-8")).hexdigest()[:20]
    return {
        "id": f"finding_{identifier}",
        "category": category,
        "severity": severity,
        "path": path,
        "line": line,
        "message": message,
        "excerpt": _redact_excerpt(excerpt),
    }


def _redact_excerpt(value: str) -> str:
    text = str(value or "").strip()[:500]
    text = PRIVATE_KEY_PATTERN.sub("[REDACTED PRIVATE KEY]", text)
    text = KNOWN_TOKEN_PATTERN.sub("[REDACTED TOKEN]", text)
    text = BEARER_PATTERN.sub("Bearer [REDACTED]", text)
    text = DATABASE_URL_PATTERN.sub("database://[REDACTED]@", text)
    text = PRIVATE_URL_PATTERN.sub("[REDACTED PRIVATE URL]", text)
    for pattern in ABSOLUTE_PATH_PATTERNS:
        text = pattern.sub(" [REDACTED LOCAL PATH]", text)
    assignment = CREDENTIAL_ASSIGNMENT_PATTERN.search(text)
    if assignment and _is_sensitive_credential_name(assignment.group(1)) and _looks_like_literal_secret(assignment.group(2)):
        text = text[: assignment.start(2)] + "[REDACTED]"
    return text


def _is_sensitive_credential_name(raw_name: str) -> bool:
    field_name = raw_name.rsplit(".", 1)[-1]
    return bool(SECRET_NAME_PATTERN.search(field_name))


def _looks_like_literal_secret(raw: str) -> bool:
    value = raw.strip().rstrip(",;)")
    if PLACEHOLDER_PATTERN.search(value) or ENV_REFERENCE_PATTERN.search(value):
        return False
    if value.lower() in {"none", "null", "undefined", "true", "false", "\"\"", "''"}:
        return False
    if re.match(r"^(?:await\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(", value):
        return False
    if value.startswith(("{", "[", "(", "...")):
        return False
    if re.match(r"^(?:new\s+|String\s*\(|Number\s*\(|Boolean\s*\()", value):
        return False
    quoted = re.match(r"^[furbFURB]*([\"'])(.*?)\1", value)
    if quoted:
        candidate = quoted.group(2).strip()
    else:
        if re.search(r"[().,\[\]{}+*/?:|&<>]", value):
            return False
        candidate = value.split()[0].strip("\"'`{}[]") if value else ""
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.()\[\]-]*", candidate):
            return False
    if len(candidate) < 10:
        return False
    if PLACEHOLDER_PATTERN.search(candidate):
        return False
    if KNOWN_TOKEN_PATTERN.search(candidate) or _entropy(candidate) >= 3.2:
        return True
    return bool(re.search(r"[A-Za-z]", candidate) and re.search(r"\d", candidate) and len(candidate) >= 16)


def _is_pattern_definition(line: str) -> bool:
    return bool(re.search(r"\b(?:re\.compile|RegExp)\s*\(", line))


def _entropy(value: str) -> float:
    if not value:
        return 0.0
    frequencies = {character: value.count(character) / len(value) for character in set(value)}
    return -sum(frequency * math.log2(frequency) for frequency in frequencies.values())


def _normalize_additional_findings(value: Any, staging: Path) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PublisherError("additional_findings must be an array.", code="invalid_dispositions")
    output: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise PublisherError("Every additional finding must be an object.", code="invalid_dispositions")
        decision = str(item.get("decision") or "").strip()
        category = str(item.get("category") or "semantic_risk").strip()[:80]
        path = str(item.get("path") or "").strip()
        line = item.get("line", 0)
        message = str(item.get("message") or "").strip()[:500]
        rationale = _clean_rationale(item.get("rationale"))
        if decision not in {"allow", "block", "not_applicable"}:
            raise PublisherError("Additional finding decisions must be allow, block, or not_applicable.", code="invalid_dispositions")
        if not path or path.startswith("/") or ".." in Path(path).parts or not (staging / path).is_file():
            raise PublisherError("Additional findings must reference a staged relative file.", code="invalid_dispositions")
        if not isinstance(line, int) or line < 0:
            raise PublisherError("Additional finding line must be a non-negative integer.", code="invalid_dispositions")
        if len(message) < 5 or len(rationale) < 10:
            raise PublisherError("Additional findings need a message and rationale.", code="invalid_dispositions")
        _assert_no_secret_value(message)
        _assert_no_secret_value(rationale)
        identifier = hashlib.sha256(f"additional\0{index}\0{category}\0{path}\0{line}\0{message}".encode("utf-8")).hexdigest()[:20]
        output.append({
            "id": f"deep_{identifier}",
            "category": category,
            "path": path,
            "line": line,
            "message": message,
            "decision": decision,
            "rationale": rationale,
        })
    return output


def _apply_requirement_updates(directory: Path, value: Any, staging: Path) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PublisherError("requirement_updates must be an array.", code="invalid_dispositions")
    requirements = read_json(directory / "requirements.json")
    existing: dict[str, dict[str, Any]] = {}
    for bucket in ("secrets", "env"):
        for item in requirements.get(bucket, []):
            if isinstance(item, dict) and isinstance(item.get("name"), str):
                existing[item["name"]] = item
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise PublisherError("Every requirement update must be an object.", code="invalid_dispositions")
        if "value" in item or "default" in item:
            raise PublisherError("Requirement updates cannot contain values or defaults.", code="secret_in_dispositions")
        name = str(item.get("name") or "").strip()
        kind = str(item.get("kind") or "").strip()
        required = item.get("required")
        purpose = _clean_rationale(item.get("purpose"))
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,127}", name) or name in seen:
            raise PublisherError("Requirement names must be unique uppercase environment names.", code="invalid_dispositions")
        if kind not in {"secret", "env"} or not isinstance(required, bool) or len(purpose) < 8:
            raise PublisherError("Requirement updates need kind, required, and a meaningful purpose.", code="invalid_dispositions")
        sources = _normalize_requirement_sources(item.get("sources"), staging)
        if not sources:
            sources = existing.get(name, {}).get("sources", [])
        if not sources:
            raise PublisherError("A new semantic requirement needs relative source evidence.", code="invalid_dispositions")
        _assert_no_secret_value(purpose)
        normalized_item = {
            "name": name,
            "kind": kind,
            "required": required,
            "purpose": purpose,
            "sources": sources,
        }
        existing[name] = normalized_item
        normalized.append(normalized_item)
        seen.add(name)
    requirements["secrets"] = sorted(
        (item for item in existing.values() if item.get("kind") == "secret"),
        key=lambda item: item["name"],
    )
    requirements["env"] = sorted(
        (item for item in existing.values() if item.get("kind") == "env"),
        key=lambda item: item["name"],
    )
    atomic_write_json(directory / "requirements.json", requirements)
    return normalized


def _normalize_requirement_sources(value: Any, staging: Path) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PublisherError("Requirement sources must be an array.", code="invalid_dispositions")
    output: list[dict[str, Any]] = []
    for source in value:
        if not isinstance(source, dict):
            raise PublisherError("Requirement source evidence must be an object.", code="invalid_dispositions")
        path = str(source.get("path") or "").strip()
        line = source.get("line", 0)
        if not path or path.startswith("/") or ".." in Path(path).parts or not (staging / path).is_file():
            raise PublisherError("Requirement evidence must reference a staged relative file.", code="invalid_dispositions")
        if not isinstance(line, int) or line < 0:
            raise PublisherError("Requirement source line must be a non-negative integer.", code="invalid_dispositions")
        evidence = {"path": path, "line": line}
        if evidence not in output:
            output.append(evidence)
    return output


def _assert_no_secret_value(text: str) -> None:
    if PRIVATE_KEY_PATTERN.search(text) or KNOWN_TOKEN_PATTERN.search(text) or BEARER_PATTERN.search(text) or DATABASE_URL_PATTERN.search(text):
        raise PublisherError("Dispositions must not contain credential values.", code="secret_in_dispositions")


def _clean_rationale(value: Any) -> str:
    return re.sub(r"\s+", " ", value).strip()[:1_000] if isinstance(value, str) else ""


def _is_text_file(path: Path, size: int) -> bool:
    if size > MAX_TEXT_SCAN_BYTES:
        return False
    try:
        sample = path.read_bytes()[:8_192]
    except OSError:
        return False
    return b"\0" not in sample


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _is_env_template(name: str) -> bool:
    return bool(re.fullmatch(r"\.env(?:[._-](?:example|sample|template))", name, re.IGNORECASE))
