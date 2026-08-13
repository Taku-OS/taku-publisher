from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from .api import (
    TakuPublisherClient,
    draft_create_payload,
    extract_draft_listing,
    extract_remote_id,
    normalize_listing_metadata,
    response_candidates,
)
from .auth import (
    auth_status,
    auth_has_scope,
    clear_publisher_session,
    publisher_account_hint,
    resolve_auth,
)
from .browser_auth import DEFAULT_SITE_URL, login_with_browser
from .bundle import build_bundle, verify_local_bundle
from .constants import (
    DEFAULT_WORKER_URL,
    SUPPORTED_MODES,
    SUPPORTED_TYPES,
    UNAVAILABLE_PUBLISH_TYPES,
)
from .discovery import assert_publish_type_available, discover_units
from .marketplace import (
    install_codex_skill,
    install_preflight,
    marketplace_item,
    marketplace_items,
)
from .scanner import (
    apply_deep_scan_dispositions,
    assert_public_payload,
    build_platform_scan_payload,
    scan_staging,
)
from .util import (
    PublisherError,
    emit_json,
    json_output,
    load_state,
    read_json,
    save_state,
)
from .workspace import initialize_draft, stage_selected

PUBLISH_MUTATION_COMMANDS = {
    "stage",
    "scan",
    "apply-review",
    "package",
    "remote-create",
    "remote-patch",
    "remote-scan",
    "remote-upload",
}

MARKETPLACE_KINDS = (
    "all",
    "app",
    "tool",
    "skill",
    "plugin",
    "mcp",
    "cli",
    "agents",
    "workflow",
    "bundle",
    "reference",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="taku-publisher", description="Safely publish one local Taku Skill.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover", help="Discover publishable units in one workspace or explicit source.")
    discover.add_argument("--workspace", required=True, type=Path)
    discover.add_argument("--source", type=Path)

    initialize = subparsers.add_parser("init", help="Explicitly select one unit and create local draft state.")
    initialize.add_argument("--workspace", required=True, type=Path)
    initialize.add_argument("--source", required=True, type=Path)
    initialize.add_argument(
        "--type",
        required=True,
        metavar="skill",
        help="Only Skill publishing is available; Action, Agent, and Plugin are not available yet.",
    )
    initialize.add_argument("--mode", required=True, choices=SUPPORTED_MODES)
    initialize.add_argument("--item-id")
    initialize.add_argument("--draft-id")

    _draft_command(subparsers, "stage", "Create an immutable staging snapshot.")
    _draft_command(subparsers, "scan", "Run deterministic scan and prepare mandatory deep review.")
    apply_review = _draft_command(subparsers, "apply-review", "Validate and apply host deep-scan dispositions.")
    apply_review.add_argument("--dispositions", required=True, type=Path)
    _draft_command(subparsers, "package", "Build a reproducible bundle.zip after all scans pass.")
    _draft_command(subparsers, "status", "Read local-only publisher state.")

    remote_create = _remote_command(subparsers, "remote-create", "Create a Taku platform publish draft.")
    remote_create.add_argument("--metadata", type=Path)
    _remote_command(subparsers, "remote-get", "Read the platform draft.")
    remote_patch = _remote_command(subparsers, "remote-patch", "Patch listing metadata on the platform draft.")
    remote_patch.add_argument("--metadata", required=True, type=Path)
    _remote_command(subparsers, "remote-scan", "Upload redacted scan and requirements documents.")
    _remote_command(subparsers, "remote-upload", "Presign, PUT bundle.zip, and complete the artifact.")
    _remote_command(subparsers, "remote-status", "Read platform draft/review status.")

    auth_check = subparsers.add_parser("auth-status", help="Check local Taku login availability without printing tokens.")
    auth_check.add_argument("--token-env", default="TAKU_BEARER_TOKEN")
    auth_refresh = subparsers.add_parser("auth-refresh", help="Refresh local Taku login availability without printing tokens.")
    auth_refresh.add_argument("--token-env", default="TAKU_BEARER_TOKEN")
    auth_login = subparsers.add_parser("auth-login", help="Authorize Taku Publisher through Taku Web.")
    auth_login.add_argument("--worker-url", default=DEFAULT_WORKER_URL)
    auth_login.add_argument("--site-url", default=DEFAULT_SITE_URL)
    auth_login.add_argument("--timeout", type=float, default=300.0)
    auth_login.add_argument("--no-open-browser", action="store_true")
    auth_login.add_argument("--allow-custom-worker-url", action="store_true")
    subparsers.add_parser("auth-logout", help="Remove the standalone Taku Publisher authorization.")

    marketplace_search = subparsers.add_parser(
        "marketplace-search",
        help="Search public Taku Marketplace community items.",
    )
    _marketplace_public_arguments(marketplace_search)
    marketplace_search.add_argument("--search", default="")
    marketplace_search.add_argument(
        "--kind",
        "--type",
        dest="kind",
        default="all",
        choices=MARKETPLACE_KINDS,
    )
    marketplace_search.add_argument("--limit", type=int, default=20)
    marketplace_search.add_argument("--offset", type=int, default=0)

    marketplace_show = subparsers.add_parser(
        "marketplace-show",
        help="Show one public Taku Marketplace Skill.",
    )
    _marketplace_public_arguments(marketplace_show)
    marketplace_show.add_argument("--item-id", required=True)

    marketplace_install = subparsers.add_parser(
        "marketplace-install",
        help="Safely install one Taku Marketplace Skill into Codex.",
    )
    _marketplace_public_arguments(marketplace_install)
    marketplace_install.add_argument("--item-id", required=True)
    marketplace_install.add_argument("--confirm-item-id")
    marketplace_install.add_argument("--host", default="codex", choices=("codex",))
    marketplace_install.add_argument("--token-env", default="TAKU_BEARER_TOKEN")
    marketplace_install.add_argument("--auth-timeout", type=float, default=300.0)
    marketplace_install.add_argument("--site-url", default=DEFAULT_SITE_URL)
    marketplace_install.add_argument("--no-browser-login", action="store_true")

    for command, help_text in (
        ("creator-doctor", "Check the bundled Stax Card creator runtime."),
        ("creator-scan", "Scan local AI tools and generate a persona/profile summary."),
        ("creator-draft", "Create a local Stax Card / Creator Page draft."),
        ("creator-editor", "Open the local Stax Card / Creator Page review editor."),
        ("creator-publish", "Publish or sync a reviewed Stax Card draft."),
        ("creator-center-list", "List the signed-in creator's Taku items."),
        ("creator-center-show", "Show one owned Taku item."),
        ("creator-center-stats", "Read trusted Creator Center statistics."),
        ("creator-center-update", "Update one owned draft's listing metadata."),
        ("creator-center-unpublish", "Remove one owned published item from the Marketplace."),
    ):
        creator = subparsers.add_parser(command, help=help_text)
        creator.add_argument("creator_args", nargs=argparse.REMAINDER)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args, unknown = parser.parse_known_args(raw_argv)
    if str(getattr(args, "command", "")).startswith("creator-"):
        command_index = raw_argv.index(args.command)
        args.creator_args = raw_argv[command_index + 1:]
        unknown = []
    if unknown:
        parser.error(f"unrecognized arguments: {' '.join(unknown)}")
    try:
        result = _dispatch(args)
        exit_code = int(result.pop("_process_exit_code", 0))
        if result.pop("_skip_emit", False):
            return exit_code
        emit_json(result)
        return exit_code
    except PublisherError as error:
        emit_json(json_output(
            ok=False,
            status="error",
            error={"code": error.code, "message": str(error), "details": error.details},
        ))
        return 1
    except KeyboardInterrupt:
        emit_json(json_output(
            ok=False,
            status="error",
            error={"code": "interrupted", "message": "Command was interrupted.", "details": {}},
        ))
        return 130


def _dispatch(args: argparse.Namespace) -> dict[str, Any]:
    if args.command.startswith("creator-"):
        return _run_creator_command(args.command.replace("creator-", "", 1), args.creator_args)

    if args.command == "auth-status":
        status = auth_status(token_env=args.token_env)
        return json_output(
            status="authenticated" if status["authenticated"] else "login_required",
            requires_action=not status["authenticated"],
            action_type=None if status["authenticated"] else "sign_in_to_taku",
            auth=status,
        )

    if args.command == "auth-refresh":
        status = auth_status(token_env=args.token_env, refresh=True)
        return json_output(
            status="authenticated" if status["authenticated"] else "login_required",
            requires_action=not status["authenticated"],
            action_type=None if status["authenticated"] else "sign_in_to_taku",
            auth=status,
        )

    if args.command == "auth-login":
        TakuPublisherClient(
            worker_url=args.worker_url,
            allow_custom_worker_url=args.allow_custom_worker_url,
        )
        status = login_with_browser(
            worker_url=args.worker_url,
            site_url=args.site_url,
            timeout=args.timeout,
            open_browser=not args.no_open_browser,
        )
        return json_output(
            status="authenticated",
            requires_action=False,
            action_type=None,
            auth=status,
        )

    if args.command == "auth-logout":
        removed = clear_publisher_session()
        return json_output(
            status="logged_out",
            requires_action=False,
            action_type=None,
            publisher_session_removed=removed,
        )

    if args.command == "marketplace-search":
        if not 1 <= args.limit <= 100 or args.offset < 0:
            raise PublisherError(
                "Marketplace limit must be 1-100 and offset cannot be negative.",
                code="invalid_marketplace_pagination",
            )
        response = _marketplace_public_client(args).search_marketplace(
            search=args.search,
            item_kind=args.kind,
            limit=args.limit,
            offset=args.offset,
        )
        items = marketplace_items(response)
        next_cursor = response.get("nextCursor") or response.get("next_cursor")
        if not isinstance(next_cursor, str) or not next_cursor.strip():
            next_cursor = None
        return json_output(
            status="marketplace_results",
            requires_action=bool(items),
            action_type="select_one_marketplace_item" if items else None,
            items=items,
            item_count=len(items),
            limit=args.limit,
            offset=args.offset,
            kind=args.kind,
            next_cursor=next_cursor,
        )

    if args.command == "marketplace-show":
        response = _marketplace_public_client(args).get_marketplace_item(
            args.item_id
        )
        return json_output(
            status="marketplace_item",
            requires_action=False,
            item=marketplace_item(response),
        )

    if args.command == "marketplace-install":
        client = _marketplace_install_client(args)
        response = client.get_marketplace_install_package(args.item_id)
        install_root = _codex_skills_root()
        preflight = install_preflight(
            response,
            item_id=args.item_id,
            install_root=install_root,
        )
        if not args.confirm_item_id:
            return json_output(
                status="confirmation_required",
                requires_action=True,
                action_type="confirm_marketplace_install",
                item=preflight["item"],
                version=preflight["version"],
                target_dir=preflight["target_dir"],
                configuration_requirements=preflight["item"][
                    "configuration_requirements"
                ],
                confirmation_rule=(
                    "Rerun with --confirm-item-id exactly matching the selected item ID."
                ),
            )
        installed = install_codex_skill(
            client,
            response,
            item_id=args.item_id,
            confirm_item_id=args.confirm_item_id,
            install_root=install_root,
        )
        return json_output(
            requires_action=True,
            action_type="start_new_codex_task",
            **installed,
        )

    if args.command == "discover":
        candidates = discover_units(args.workspace, args.source)
        return json_output(
            status="needs_selection" if candidates else "no_candidates",
            requires_action=True,
            action_type="select_one_publish_unit" if candidates else "choose_an_explicit_source",
            candidates=candidates,
            candidate_count=len(candidates),
            allowed_types=list(SUPPORTED_TYPES),
            unavailable_types=list(UNAVAILABLE_PUBLISH_TYPES),
            availability_note="Action, Agent, and Plugin publishing is not available yet.",
            selection_rule="Select exactly one Skill.",
        )

    if args.command == "init":
        directory, state = initialize_draft(
            workspace=args.workspace,
            source=args.source,
            unit_type=args.type,
            mode=args.mode,
            item_id=args.item_id,
            draft_id=args.draft_id,
        )
        return json_output(
            status="selected",
            requires_action=True,
            action_type="confirm_selection_and_create_platform_draft",
            draft_id=state["draft_id"],
            mode=state["mode"],
            item_id=state["item_id"],
            unit=_public_unit(state["unit"]),
            local_state_dir=str(directory),
        )

    directory, state = load_state(args.draft_id)
    if args.command in PUBLISH_MUTATION_COMMANDS:
        unit = state.get("unit") if isinstance(state.get("unit"), dict) else {}
        assert_publish_type_available(str(unit.get("type") or ""))
    if args.command == "stage":
        result = stage_selected(directory, state)
        return json_output(status="staged", draft_id=args.draft_id, **result)
    if args.command == "scan":
        result = scan_staging(directory, state)
        blocking = result["report"]["summary"]["blocking"]
        if blocking:
            return json_output(
                status="blocked",
                requires_action=True,
                action_type="fix_source_and_start_new_draft",
                draft_id=args.draft_id,
                scan_summary=result["report"]["summary"],
                report_path=str(directory / "scan-report.json"),
            )
        return json_output(
            status="awaiting_deep_scan",
            requires_action=True,
            action_type="perform_semantic_review",
            draft_id=args.draft_id,
            scan_summary=result["report"]["summary"],
            requirements=result["requirements"],
            deep_scan_request_path=str(directory / "deep-scan-request.json"),
            dispositions_template_path=str(directory / "deep-scan-dispositions.template.json"),
        )
    if args.command == "apply-review":
        reviewed = apply_deep_scan_dispositions(directory, state, args.dispositions)
        if reviewed["blocked"]:
            return json_output(
                status="blocked",
                requires_action=True,
                action_type="fix_source_and_start_new_draft",
                draft_id=args.draft_id,
                reviewed_scan_path=str(directory / "deep-scan-dispositions.json"),
            )
        return json_output(
            status="ready_to_package",
            draft_id=args.draft_id,
            reviewed_scan_path=str(directory / "deep-scan-dispositions.json"),
        )
    if args.command == "package":
        artifact = build_bundle(directory, state)
        action_type = "upload_artifact" if state.get("remote_draft_id") else "create_platform_draft"
        return json_output(
            status="packaged",
            requires_action=True,
            action_type=action_type,
            draft_id=args.draft_id,
            artifact=artifact,
        )
    if args.command == "status":
        return json_output(
            status=state.get("status") or "unknown",
            draft_id=args.draft_id,
            mode=state.get("mode"),
            item_id=state.get("item_id"),
            unit=_public_unit(state.get("unit") or {}),
            stage_sha256=state.get("stage_sha256"),
            bundle_sha256=state.get("bundle_sha256"),
            remote_draft_id=state.get("remote_draft_id"),
            remote_artifact_id=state.get("remote_artifact_id"),
            status_scope="local_only",
        )

    client = _client(args)
    if args.command == "remote-create":
        payload = draft_create_payload(state)
        if args.metadata:
            metadata = read_json(args.metadata.expanduser().resolve())
            if not isinstance(metadata, dict):
                raise PublisherError("Metadata must be a JSON object.", code="invalid_metadata")
            metadata = normalize_listing_metadata(metadata)
            assert_public_payload(metadata)
            payload["listing"] = {**(payload.get("listing") or {}), **metadata}
        icon_error = None
        if (
            state.get("mode") != "update"
            and not str((payload.get("listing") or {}).get("iconUrl") or "").strip()
        ):
            try:
                icon = client.generate_listing_icon(_icon_generation_payload(payload, state))
                icon_url = _response_value(icon, "imageUrl", "image_url")
                if not _public_https_url(icon_url):
                    raise PublisherError(
                        "Taku icon generation did not return a valid HTTPS image URL.",
                        code="invalid_generated_icon",
                    )
                payload["listing"]["iconUrl"] = icon_url
            except PublisherError as error:
                icon_error = {"code": error.code, "message": str(error), "details": error.details}
        response = client.create_draft(payload)
        remote_id = extract_remote_id(response, "draftId", "draft_id", "id")
        state.update({
            "remote_draft_id": remote_id,
            "status": "remote_draft_created",
            "listing": payload.get("listing") or {},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        save_state(directory, state)
        review_url = _response_value(response, "reviewUrl", "review_url")
        if icon_error:
            return json_output(
                status="remote_draft_created",
                requires_action=True,
                action_type="generate_icon_on_taku_web_before_upload",
                draft_id=args.draft_id,
                remote_draft_id=remote_id,
                review_url=review_url,
                warning="Taku icon generation failed before upload. This is the only icon path that needs manual web editing: open the listing draft while it is still editable, generate or add an icon, save it, then continue with scan and package upload.",
                icon_error=icon_error,
            )
        if _local_upload_ready(directory, state):
            scan_response = _upload_scan_report(client, directory, state, remote_id)
            completed = _upload_bundle_artifact(client, directory, state, remote_id)
            return json_output(
                status="awaiting_web_confirmation",
                requires_action=True,
                action_type="review_and_submit_on_taku_web",
                remote_draft_id=remote_id,
                artifact_id=completed["artifact_id"],
                review_url=completed["review_url"] or review_url,
                publisher_account_hint=publisher_account_hint(token_env=args.token_env),
                response=completed["response"],
                scan_response=scan_response,
                note="Listing draft, scan results, and package were uploaded in one step. The final confirmation page is ready.",
            )
        return json_output(
            status="remote_draft_created",
            action_type="continue_local_scan_and_upload" if review_url else None,
            next_step="continue_local_scan_package_and_upload",
            next_commands=["stage", "scan", "apply-review", "package", "remote-scan", "remote-upload"],
            draft_id=args.draft_id,
            remote_draft_id=remote_id,
            review_url=review_url,
            note="Listing draft created. Publish release stays disabled until scan results and package are uploaded.",
        )

    remote_id = _require_remote_id(state)
    if args.command == "remote-get":
        return json_output(status="remote_draft", remote_draft=client.get_draft(remote_id))
    if args.command == "remote-patch":
        metadata = read_json(args.metadata.expanduser().resolve())
        if not isinstance(metadata, dict):
            raise PublisherError("Metadata must be a JSON object.", code="invalid_metadata")
        metadata = normalize_listing_metadata(metadata)
        assert_public_payload(metadata)
        response = client.update_draft(remote_id, {"listing": metadata})
        state["listing"] = {**(state.get("listing") if isinstance(state.get("listing"), dict) else {}), **metadata}
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_state(directory, state)
        return json_output(status="remote_draft_updated", remote_draft=response)
    if args.command == "remote-scan":
        response = _upload_scan_report(client, directory, state, remote_id)
        return json_output(status="scan_report_uploaded", remote_draft_id=remote_id, response=response)
    if args.command == "remote-upload":
        completed = _upload_bundle_artifact(client, directory, state, remote_id)
        return json_output(
            status="awaiting_web_confirmation",
            requires_action=True,
            action_type="review_and_submit_on_taku_web",
            remote_draft_id=remote_id,
            artifact_id=completed["artifact_id"],
            review_url=completed["review_url"],
            publisher_account_hint=publisher_account_hint(token_env=args.token_env),
            response=completed["response"],
        )
    if args.command == "remote-status":
        response = client.get_status(remote_id)
        return json_output(
            status="remote_status",
            remote_draft_id=remote_id,
            asset_identity=extract_asset_identity(response),
            remote_status=response,
        )

    raise PublisherError(f"Unknown command: {args.command}", code="unknown_command")


def extract_asset_identity(response: dict[str, Any]) -> dict[str, Any] | None:
    """Return Worker's relationship envelope without inferring identity from names or paths."""
    for candidate in response_candidates(response):
        for key in ("assetIdentity", "asset_identity"):
            identity = candidate.get(key)
            if not isinstance(identity, dict):
                continue
            resource_id = identity.get("resourceId") or identity.get("resource_id")
            if isinstance(resource_id, str) and resource_id.strip():
                return identity
    return None


def _run_creator_command(command: str, creator_args: list[str]) -> dict[str, Any]:
    root = Path(__file__).resolve().parents[2]
    script = root / "creator" / "scripts" / "taku_creator.mjs"
    if not script.exists():
        raise PublisherError(
            "Bundled Taku Creator runtime is missing.",
            code="creator_runtime_missing",
            details={"expected_script": str(script)},
        )

    creates_persona = command in {"scan", "draft"} or (
        command == "editor" and _creator_argument(creator_args, "draft") is None
    )
    creator_center_scope = {
        "center-list": "creator.items.read",
        "center-show": "creator.items.read",
        "center-stats": "creator.stats.read",
        "center-update": "creator.items.write",
        "center-unpublish": "creator.items.unpublish",
    }.get(command)
    auth = None
    if command == "publish" or creates_persona or creator_center_scope:
        auth = resolve_auth()
        required_scope = creator_center_scope or "creator.card.write"
        if not auth_has_scope(auth, required_scope):
            worker_url = _creator_argument(creator_args, "worker-url") or "https://worker.taku.ai"
            site_url = _creator_argument(creator_args, "site-url") or DEFAULT_SITE_URL
            allow_custom_worker = (
                "--allow-custom-worker-url" in creator_args
                or worker_url == "https://worker.taku.ai"
            )
            TakuPublisherClient(
                worker_url=worker_url,
                allow_custom_worker_url=allow_custom_worker,
            )
            login_with_browser(
                worker_url=worker_url,
                site_url=site_url,
                intent=(
                    "creator_center_unpublish"
                    if command == "center-unpublish"
                    else "creator_center"
                    if creator_center_scope
                    else "publish_stax_card"
                ),
            )
            refreshed_auth = resolve_auth()
            if not auth_has_scope(refreshed_auth, required_scope):
                raise PublisherError(
                    "Taku authorization did not grant the requested Creator access.",
                    code=(
                        "creator_center_auth_scope_missing"
                        if creator_center_scope
                        else "creator_auth_scope_missing"
                    ),
                )
            auth = refreshed_auth

    forwarded = ["node", str(script), command, *creator_args]
    passthrough = command == "editor" or (command == "draft" and "--editor" in creator_args)
    env = _creator_subprocess_env()
    if auth and auth.token and not env.get("TAKU_PUBLISH_TOKEN"):
        env["TAKU_PUBLISH_TOKEN"] = auth.token
    try:
        if passthrough:
            completed = subprocess.run(forwarded, check=False, env=env)
            return {"_skip_emit": True, "_process_exit_code": completed.returncode}
        completed = subprocess.run(forwarded, check=False, text=True, capture_output=True, env=env)
    except FileNotFoundError as error:
        raise PublisherError(
            "Node.js is required for Stax Card and Builder Profile generation.",
            code="node_missing",
        ) from error

    if completed.stderr:
        sys.stderr.write(completed.stderr)
    payload = _parse_creator_json(completed.stdout)
    payload["_process_exit_code"] = completed.returncode
    return payload


def _creator_subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    proxy_url = _normalized_loopback_proxy(env)
    if proxy_url:
        for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
            env[name] = proxy_url
        for name in ("ALL_PROXY", "all_proxy"):
            env.pop(name, None)
    no_proxy = [item.strip() for item in env.get("NO_PROXY", env.get("no_proxy", "")).split(",") if item.strip()]
    for host in ("127.0.0.1", "localhost", "::1"):
        if host not in no_proxy:
            no_proxy.append(host)
    env["NO_PROXY"] = ",".join(no_proxy)
    env["no_proxy"] = env["NO_PROXY"]
    return env


def _normalized_loopback_proxy(env: dict[str, str]) -> str | None:
    for name in ("https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"):
        value = str(env.get(name) or "").strip()
        if not value:
            continue
        parsed = urlparse(value)
        if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            return None
        if parsed.port and _can_connect_loopback(parsed.port):
            return value
        for fallback_port in (7897, 7890):
            if _can_connect_loopback(fallback_port):
                return f"{parsed.scheme or 'http'}://localhost:{fallback_port}"
        return None
    return None


def _can_connect_loopback(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=0.2):
            return True
    except OSError:
        return False


def _parse_creator_json(stdout: str) -> dict[str, Any]:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise PublisherError(
            "Taku Creator returned non-JSON output.",
            code="creator_invalid_output",
            details={"output": stdout[:1000]},
        ) from error
    if not isinstance(payload, dict):
        raise PublisherError(
            "Taku Creator returned an invalid JSON payload.",
            code="creator_invalid_output",
        )
    return payload


def _creator_argument(arguments: list[str], name: str) -> str | None:
    flag = f"--{name}"
    for index, value in enumerate(arguments):
        if value.startswith(f"{flag}="):
            return value.split("=", 1)[1].strip() or None
        if value == flag and index + 1 < len(arguments):
            return arguments[index + 1].strip() or None
    return None


def _draft_command(subparsers: argparse._SubParsersAction, name: str, help_text: str) -> argparse.ArgumentParser:
    command = subparsers.add_parser(name, help=help_text)
    command.add_argument("--draft-id", required=True)
    return command


def _remote_command(subparsers: argparse._SubParsersAction, name: str, help_text: str) -> argparse.ArgumentParser:
    command = _draft_command(subparsers, name, help_text)
    command.add_argument("--worker-url", default=DEFAULT_WORKER_URL)
    command.add_argument("--token-env", default="TAKU_BEARER_TOKEN")
    command.add_argument("--timeout", type=float, default=30.0)
    command.add_argument("--auth-timeout", type=float, default=300.0)
    command.add_argument("--site-url", default=DEFAULT_SITE_URL)
    command.add_argument("--no-browser-login", action="store_true")
    command.add_argument("--allow-custom-worker-url", action="store_true")
    return command


def _marketplace_public_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument("--json", action="store_true")
    command.add_argument("--worker-url", default=DEFAULT_WORKER_URL)
    command.add_argument("--timeout", type=float, default=30.0)
    command.add_argument("--allow-custom-worker-url", action="store_true")


def _marketplace_public_client(args: argparse.Namespace) -> TakuPublisherClient:
    return TakuPublisherClient(
        worker_url=args.worker_url,
        timeout=args.timeout,
        allow_custom_worker_url=args.allow_custom_worker_url,
    )


def _marketplace_install_client(args: argparse.Namespace) -> TakuPublisherClient:
    auth = resolve_auth(token_env=args.token_env)
    required_scopes = (
        "marketplace.packages.read",
        "marketplace.installs.write",
    )
    client = TakuPublisherClient(
        worker_url=args.worker_url,
        token=auth.token,
        timeout=args.timeout,
        allow_custom_worker_url=args.allow_custom_worker_url,
    )
    if all(auth_has_scope(auth, scope) for scope in required_scopes):
        return client
    if args.no_browser_login:
        return client

    login_with_browser(
        worker_url=client.worker_url,
        site_url=args.site_url,
        intent="marketplace_install",
        timeout=args.auth_timeout,
    )
    refreshed_auth = resolve_auth(token_env=args.token_env)
    if not all(auth_has_scope(refreshed_auth, scope) for scope in required_scopes):
        raise PublisherError(
            "Taku authorization did not grant Marketplace install access.",
            code="marketplace_auth_scope_missing",
        )
    return TakuPublisherClient(
        worker_url=client.worker_url,
        token=refreshed_auth.token,
        timeout=args.timeout,
        allow_custom_worker_url=True,
    )


def _codex_skills_root() -> Path:
    codex_home = Path(
        os.environ.get("CODEX_HOME")
        or (Path.home() / ".codex")
    ).expanduser().resolve()
    if codex_home == Path(codex_home.anchor) or codex_home == Path.home().resolve():
        raise PublisherError(
            "Codex home is too broad for a safe Skill install.",
            code="unsafe_install_target",
        )
    return codex_home / "skills"


def _client(args: argparse.Namespace) -> TakuPublisherClient:
    auth = resolve_auth(token_env=args.token_env)
    client = TakuPublisherClient(
        worker_url=args.worker_url,
        token=auth.token,
        icon_token=auth.icon_token,
        timeout=args.timeout,
        allow_custom_worker_url=args.allow_custom_worker_url,
    )
    if auth_has_scope(auth, "publisher.drafts.write") or args.no_browser_login:
        return client

    login_with_browser(
        worker_url=client.worker_url,
        site_url=args.site_url,
        intent="publish_tool",
        timeout=args.auth_timeout,
    )
    auth = resolve_auth(token_env=args.token_env)
    return TakuPublisherClient(
        worker_url=client.worker_url,
        token=auth.token,
        icon_token=auth.icon_token,
        timeout=args.timeout,
        allow_custom_worker_url=True,
    )


def _require_remote_id(state: dict[str, Any]) -> str:
    value = str(state.get("remote_draft_id") or "").strip()
    if not value:
        raise PublisherError("Create the platform draft before using remote draft commands.", code="missing_remote_draft")
    return value


def _local_upload_ready(directory: Path, state: dict[str, Any]) -> bool:
    try:
        verify_local_bundle(directory, state)
        build_platform_scan_payload(directory, state)
    except PublisherError:
        return False
    return True


def _upload_scan_report(
    client: TakuPublisherClient,
    directory: Path,
    state: dict[str, Any],
    remote_id: str,
) -> dict[str, Any]:
    payload = build_platform_scan_payload(directory, state)
    assert_public_payload(payload)
    return client.submit_scan_report(remote_id, payload)


def _upload_bundle_artifact(
    client: TakuPublisherClient,
    directory: Path,
    state: dict[str, Any],
    remote_id: str,
) -> dict[str, Any]:
    listing = _preserve_remote_listing(client, directory, state, remote_id)
    bundle_path = verify_local_bundle(directory, state)
    size = bundle_path.stat().st_size
    sha256 = state["bundle_sha256"]
    presigned = client.presign_artifact(remote_id, size=size, sha256=sha256)
    upload_url = _response_value(presigned, "uploadUrl", "upload_url", required=True)
    artifact_id = extract_remote_id(presigned, "artifactId", "artifact_id", "id")
    upload_headers = _response_object(presigned, "headers", "uploadHeaders", "upload_headers")
    client.upload_signed(upload_url, bundle_path, headers=upload_headers)
    completed = client.complete_artifact(remote_id, artifact_id, size=size, sha256=sha256)
    review_url = _response_value(completed, "reviewUrl", "review_url", required=True)
    _assert_review_url_draft(review_url, remote_id)
    completed_draft = client.get_draft(remote_id)
    completed_listing = extract_draft_listing(completed_draft)
    changed_fields = _changed_listing_fields(listing, completed_listing)
    if changed_fields:
        raise PublisherError(
            "Taku did not preserve the saved listing while completing the package upload.",
            code="remote_listing_not_preserved",
            details={
                "remote_draft_id": remote_id,
                "review_url": (
                    _response_value(completed_draft, "reviewUrl", "review_url")
                    or review_url
                ),
                "changed_fields": changed_fields,
            },
        )
    state.update({
        "status": "awaiting_web_confirmation",
        "remote_artifact_id": artifact_id,
        "listing": completed_listing,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    save_state(directory, state)
    return {
        "artifact_id": artifact_id,
        "review_url": review_url,
        "response": completed,
    }


def _preserve_remote_listing(
    client: TakuPublisherClient,
    directory: Path,
    state: dict[str, Any],
    remote_id: str,
) -> dict[str, Any]:
    remote_draft = client.get_draft(remote_id)
    listing = extract_draft_listing(remote_draft)
    missing_fields = _required_listing_fields(listing)
    if missing_fields:
        raise PublisherError(
            "Save the title, description, and icon on the Taku Web listing before uploading the package.",
            code="remote_listing_incomplete",
            details={
                "remote_draft_id": remote_id,
                "review_url": _response_value(remote_draft, "reviewUrl", "review_url"),
                "missing_fields": missing_fields,
            },
        )
    saved = client.update_draft(remote_id, {"listing": listing})
    saved_listing = extract_draft_listing(saved) or listing
    missing_saved_fields = _required_listing_fields(saved_listing)
    if missing_saved_fields:
        raise PublisherError(
            "Taku did not confirm the latest Web listing before package upload.",
            code="remote_listing_not_saved",
            details={
                "remote_draft_id": remote_id,
                "review_url": (
                    _response_value(saved, "reviewUrl", "review_url")
                    or _response_value(remote_draft, "reviewUrl", "review_url")
                ),
                "missing_fields": missing_saved_fields,
            },
        )
    state["listing"] = saved_listing
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_state(directory, state)
    return saved_listing


def _required_listing_fields(listing: dict[str, Any] | None) -> list[str]:
    if listing is None:
        return ["listing"]
    missing = []
    if not str(listing.get("title") or "").strip():
        missing.append("title")
    if not str(listing.get("description") or "").strip():
        missing.append("description")
    if not str(listing.get("iconUrl") or "").strip():
        missing.append("iconUrl")
    return missing


def _changed_listing_fields(
    expected: dict[str, Any],
    actual: dict[str, Any] | None,
) -> list[str]:
    if actual is None:
        return ["listing"]
    return [
        field
        for field in ("title", "description", "iconUrl")
        if expected.get(field) != actual.get(field)
    ]


def _assert_review_url_draft(review_url: str, remote_id: str) -> None:
    try:
        path_segments = [segment for segment in urlparse(review_url).path.split("/") if segment]
        linked_draft_id = unquote(path_segments[-1]) if path_segments else ""
    except (ValueError, UnicodeError):
        linked_draft_id = ""
    if linked_draft_id != remote_id:
        raise PublisherError(
            "Taku returned a final review page for a different draft.",
            code="remote_review_draft_mismatch",
            details={"remote_draft_id": remote_id},
        )


def _public_unit(unit: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": unit.get("id"),
        "type": unit.get("type"),
        "name": unit.get("name"),
        "description": unit.get("description") or "",
        "relative_path": unit.get("relative_path"),
        "children": unit.get("children") or [],
    }


def _response_value(response: dict[str, Any], *keys: str, required: bool = False) -> str | None:
    for candidate in response_candidates(response):
        for key in keys:
            value = candidate.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if required:
        raise PublisherError(f"Platform response is missing {keys[0]}.", code="invalid_api_response")
    return None


def _icon_generation_payload(payload: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    listing = payload.get("listing") if isinstance(payload.get("listing"), dict) else {}
    tool = payload.get("tool") if isinstance(payload.get("tool"), dict) else {}
    title = str(listing.get("title") or tool.get("name") or "Taku tool").strip()
    description = str(listing.get("shortDescription") or tool.get("description") or "").strip()
    categories = listing.get("categories") if isinstance(listing.get("categories"), list) else []
    tags = listing.get("tags") if isinstance(listing.get("tags"), list) else []
    tool_type = str(payload.get("toolType") or tool.get("type") or "").strip()
    category = str(categories[0]) if categories else ""
    return {
        "capabilities": [
            {
                "id": str(tool.get("id") or state.get("draft_id") or title),
                "name": title,
                "title": title,
                "description": description,
                "kind": tool_type,
                "type": tool_type,
                "category": category,
                "tags": tags,
                "communityTitle": title,
                "communityDescription": description,
                "communityDisplayKind": tool_type,
                "communityCategory": category,
                "communityTags": tags,
            }
        ],
        "draft": {
            "title": title,
            "description": description,
            "itemType": tool_type,
            "category": category,
            "tags": tags,
        },
    }


def _public_https_url(value: str | None) -> bool:
    if not value:
        return False
    from urllib.parse import urlparse

    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.hostname)


def _response_object(response: dict[str, Any], *keys: str) -> dict[str, str]:
    for candidate in response_candidates(response):
        for key in keys:
            value = candidate.get(key)
            if isinstance(value, dict):
                return {str(header): str(header_value) for header, header_value in value.items()}
    return {}
