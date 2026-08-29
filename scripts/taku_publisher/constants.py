from __future__ import annotations

import os
from pathlib import Path


SCHEMA_VERSION = "taku.publisher.v1"
PUBLISHER_USER_AGENT = "Taku-Publisher/1.0 (+https://taku.ai)"
SUPPORTED_TYPES = ("skill",)
UNAVAILABLE_PUBLISH_TYPES = ("action", "agent", "plugin")
SUPPORTED_MODES = ("create", "update")
SUPPORTED_RUNTIME_PLATFORMS = ("taku", "codex", "claude-code")
DEFAULT_WORKER_URL = "https://worker.taku.ai"

MAX_FILES = 1_000
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_TEXT_SCAN_BYTES = MAX_FILE_BYTES
MAX_DISCOVERY_DEPTH = 6

EXCLUDED_DIR_NAMES = {
    ".aws",
    ".azure",
    ".cache",
    ".git",
    ".gnupg",
    ".idea",
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".pytest_cache",
    ".ssh",
    ".svelte-kit",
    ".terraform",
    ".tmp",
    ".turbo",
    ".venv",
    ".vscode",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "logs",
    "node_modules",
    "out",
    "target",
    "temp",
    "tmp",
    "venv",
}

SECRET_DIR_NAMES = {
    ".aws",
    ".azure",
    ".credentials",
    ".gnupg",
    ".oauth",
    ".sessions",
    ".ssh",
}

EXCLUDED_FILE_NAMES = {
    ".dockercfg",
    ".ds_store",
    ".git",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "credentials.json",
    "id_rsa",
    "id_ed25519",
    "secrets.json",
}

SECRET_FILE_SUFFIXES = {
    ".db",
    ".key",
    ".p12",
    ".pfx",
    ".pem",
    ".sqlite",
    ".sqlite3",
}

TEXT_FILE_SUFFIXES = {
    "",
    ".bash",
    ".c",
    ".cfg",
    ".conf",
    ".cpp",
    ".css",
    ".csv",
    ".go",
    ".h",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".md",
    ".markdown",
    ".mjs",
    ".php",
    ".properties",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".sql",
    ".svg",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
    ".zsh",
}


def publisher_home() -> Path:
    override = os.environ.get("TAKU_PUBLISHER_HOME", "").strip()
    return Path(override).expanduser().resolve() if override else Path.home() / ".taku" / "publisher"
