#!/usr/bin/env python3

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
import tomllib
from pathlib import Path
from typing import Any

VERSION = "0.4.0"
SCRIPT_NAME = "codex-environment-injector.js"
SCRIPT_KEY = f"user:{SCRIPT_NAME}"
LEGACY_SCRIPT_KEYS = (
    "user:codex-profile-selector.js",
    "user:codex-profile-studio.js",
)
LEGACY_SCRIPT_NAMES = (
    "codex-profile-selector.js",
    "codex-profile-studio.js",
)
PROFILE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
SENSITIVE_KEY_RE = re.compile(
    r"(?:api[_-]?key|token|secret|password|authorization|bearer|credential|auth_contents)",
    re.IGNORECASE,
)
ALLOWED_TOP_LEVEL = {
    "model",
    "model_provider",
    "model_reasoning_effort",
    "model_reasoning_summary",
    "service_tier",
    "approval_policy",
    "sandbox_mode",
    "developer_instructions",
    "base_instructions",
    "memories",
    "personality",
    "web_search",
    "model_catalog_json",
    "model_providers",
    "plugins",
    "features",
}
EXPLICIT_KEYS = {
    "model",
    "model_provider",
    "developer_instructions",
    "base_instructions",
    "memories",
    "approval_policy",
    "sandbox_mode",
    "service_tier",
}
MAX_PROFILE_JSON_BYTES = 128 * 1024
MAX_DEVELOPER_INSTRUCTIONS_CHARS = 40_000
MAX_EMBEDDED_TEXT_CHARS = 128 * 1024
URL_CREDENTIAL_RE = re.compile(r"[a-z][a-z0-9+.-]*://[^/\s@]+:[^/\s@]+@", re.IGNORECASE)
TEXT_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9_./+\-=]{12,}", re.IGNORECASE),
    re.compile(
        r"""((?:api[_-]?key|token|password|secret|authorization|credential)["']?\s*[:=]\s*["']?)[^"'\s,;}]+""",
        re.IGNORECASE,
    ),
    URL_CREDENTIAL_RE,
)


class SyncError(RuntimeError):
    pass


def timestamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def generated_at() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def load_toml(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            value = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise SyncError(f"failed to parse {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SyncError(f"profile root must be a TOML table: {path}")
    return value


def json_safe(value: Any, path: tuple[str, ...]) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [json_safe(item, path) for item in value]
    if isinstance(value, dict):
        return {
            str(key): json_safe(item, path + (str(key),))
            for key, item in value.items()
        }
    dotted = ".".join(path) or "<root>"
    raise SyncError(
        f"unsupported TOML value type at {dotted}: {type(value).__name__}"
    )


def sanitize_value(
    value: Any,
    path: tuple[str, ...],
    removed: list[str],
) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            child_path = path + (key_text,)
            if SENSITIVE_KEY_RE.search(key_text):
                removed.append(".".join(child_path))
                continue
            result[key_text] = sanitize_value(item, child_path, removed)
        return result
    if isinstance(value, list):
        return [sanitize_value(item, path, removed) for item in value]
    if isinstance(value, str):
        if URL_CREDENTIAL_RE.search(value):
            raise SyncError("credential-bearing URLs are not allowed in profiles; use environment variable references")
        return redact_embedded_text(value, ".".join(path), removed)
    return json_safe(value, path)


def filtered_profile_config(
    raw: dict[str, Any],
    profile_name: str,
) -> tuple[dict[str, Any], list[str]]:
    removed: list[str] = []
    filtered: dict[str, Any] = {}
    for key, value in raw.items():
        if key == "model_instructions_file":
            removed.append(f"{profile_name}.model_instructions_file (unsupported per-thread)")
            continue
        if key not in ALLOWED_TOP_LEVEL:
            continue
        if SENSITIVE_KEY_RE.search(key):
            removed.append(f"{profile_name}.{key}")
            continue
        filtered[key] = sanitize_value(value, (profile_name, key), removed)
    return filtered, removed


def profile_payload(path: Path) -> tuple[dict[str, Any], list[str]]:
    suffix = ".config.toml"
    name = path.name[: -len(suffix)]
    if not PROFILE_NAME_RE.fullmatch(name):
        raise SyncError(f"invalid profile-v2 filename: {path.name}")

    raw = load_toml(path)
    filtered, removed = filtered_profile_config(raw, name)
    developer_instructions = filtered.get("developer_instructions", "")
    if not isinstance(developer_instructions, str):
        raise SyncError(f"{name}.developer_instructions must be a string")
    if len(developer_instructions) > MAX_DEVELOPER_INSTRUCTIONS_CHARS:
        raise SyncError(
            f"{name}.developer_instructions exceeds "
            f"{MAX_DEVELOPER_INSTRUCTIONS_CHARS} characters"
        )
    base_instructions = filtered.get("base_instructions", "")
    if not isinstance(base_instructions, str):
        raise SyncError(f"{name}.base_instructions must be a string")
    if len(base_instructions) > MAX_DEVELOPER_INSTRUCTIONS_CHARS:
        raise SyncError(
            f"{name}.base_instructions exceeds "
            f"{MAX_DEVELOPER_INSTRUCTIONS_CHARS} characters"
        )
    memory_config = filtered.get("memories") if isinstance(filtered.get("memories"), dict) else {}
    memory_policy: dict[str, str] = {}
    if isinstance(memory_config.get("use_memories"), bool):
        memory_policy["use"] = "on" if memory_config["use_memories"] else "off"
    if isinstance(memory_config.get("generate_memories"), bool):
        memory_policy["generate"] = "on" if memory_config["generate_memories"] else "off"

    thread_config = {
        key: value for key, value in filtered.items() if key not in EXPLICIT_KEYS
    }
    payload: dict[str, Any] = {
        "id": name,
        "name": name,
        "source": "file",
        "sourceFileName": path.name,
        "model": str(filtered.get("model", "") or ""),
        "modelProvider": str(filtered.get("model_provider", "") or ""),
        "config": thread_config,
    }
    if developer_instructions:
        payload["developerInstructions"] = developer_instructions
    if base_instructions:
        payload["baseInstructions"] = base_instructions
    if memory_policy:
        payload["memoryPolicy"] = memory_policy
    if filtered.get("approval_policy"):
        payload["approvalPolicy"] = str(filtered["approval_policy"])
    if filtered.get("sandbox_mode"):
        payload["sandbox"] = str(filtered["sandbox_mode"])
    if filtered.get("service_tier"):
        payload["serviceTier"] = str(filtered["service_tier"])

    encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode(
        "utf-8"
    )
    if len(encoded) > MAX_PROFILE_JSON_BYTES:
        raise SyncError(
            f"generated profile {name} exceeds {MAX_PROFILE_JSON_BYTES} bytes"
        )
    return payload, removed


def discover_profiles(
    codex_home: Path,
    includes: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    include_set = set(includes or [])
    profiles: list[dict[str, Any]] = []
    warnings: list[str] = []
    for path in sorted(codex_home.glob("*.config.toml"), key=lambda item: item.name.lower()):
        name = path.name[: -len(".config.toml")]
        if include_set and name not in include_set:
            continue
        payload, removed = profile_payload(path)
        profiles.append(payload)
        warnings.extend(removed)
    missing = sorted(include_set - {profile["id"] for profile in profiles})
    if missing:
        raise SyncError("profiles not found: " + ", ".join(missing))
    return profiles, warnings


def sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def redact_embedded_text(value: str, label: str, warnings: list[str]) -> str:
    text = value[:MAX_EMBEDDED_TEXT_CHARS]
    if len(value) > MAX_EMBEDDED_TEXT_CHARS:
        warnings.append(f"{label} truncated to {MAX_EMBEDDED_TEXT_CHARS} characters")
    for pattern in TEXT_SECRET_PATTERNS:
        text, count = pattern.subn(
            lambda match: (match.group(1) if match.lastindex else "") + "<redacted>",
            text,
        )
        if count:
            warnings.append(f"{label}: redacted {count} secret-looking value(s)")
    return text


def read_environment_text(path: Path, label: str, warnings: list[str]) -> dict[str, Any]:
    if not path.exists() or not path.is_file():
        return {"exists": False, "name": path.name, "content": "", "hash": None}
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        warnings.append(f"failed to read {label}: {exc}")
        return {"exists": True, "name": path.name, "content": "", "hash": None, "error": str(exc)}
    return {
        "exists": True,
        "name": path.name,
        "content": redact_embedded_text(raw, label, warnings),
        "hash": sha256_text(raw),
        "size": len(raw.encode("utf-8")),
        "modifiedAt": dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds"),
    }


def build_environment_snapshot(codex_home: Path, warnings: list[str]) -> dict[str, Any]:
    config_path = codex_home / "config.toml"
    config: dict[str, Any] = {}
    if config_path.exists():
        try:
            config = load_toml(config_path)
        except SyncError as exc:
            warnings.append(str(exc))
    features = config.get("features") if isinstance(config.get("features"), dict) else {}
    memories = config.get("memories") if isinstance(config.get("memories"), dict) else {}
    memory_settings = {
        key: memories[key]
        for key in (
            "generate_memories",
            "use_memories",
            "disable_on_external_context",
            "no_memories_if_mcp_or_web_search",
            "min_rate_limit_remaining_percent",
            "extract_model",
            "consolidation_model",
        )
        if key in memories
    }
    memory_settings["enabled"] = bool(features.get("memories", False))

    override_path = codex_home / "AGENTS.override.md"
    agents_path = override_path if override_path.exists() and override_path.stat().st_size > 0 else codex_home / "AGENTS.md"
    memories_root = codex_home / "memories"
    memory_files: list[dict[str, Any]] = []
    if memories_root.exists():
        for path in sorted(memories_root.rglob("*"), key=lambda item: str(item).lower()):
            if not path.is_file() or ".git" in path.parts:
                continue
            relative = path.relative_to(memories_root).as_posix()
            memory_files.append({
                "path": relative,
                "size": path.stat().st_size,
                "modifiedAt": dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds"),
            })

    return {
        "capabilities": {
            "source": "generated-snapshot",
            "diskRead": True,
            "diskWrite": False,
            "bridge": False,
        },
        "globalAgents": read_environment_text(agents_path, "global AGENTS", warnings),
        "memory": {
            "settings": memory_settings,
            "summary": read_environment_text(memories_root / "memory_summary.md", "memory summary", warnings),
            "durable": read_environment_text(memories_root / "MEMORY.md", "durable memory", warnings),
            "files": memory_files,
        },
    }


def render_userscript(
    template_text: str,
    studio_text: str,
    profiles: list[dict[str, Any]],
    warnings: list[str],
    environment_snapshot: dict[str, Any] | None = None,
    react_ui_text: str = "",
    generated_at_value: str | None = None,
) -> str:
    token = "__CODEX_ENVIRONMENT_BUNDLE__"
    if template_text.count(token) != 1:
        raise SyncError("environment userscript template must contain exactly one bundle token")
    bundle = {
        "schemaVersion": 2,
        "generatorVersion": VERSION,
        "generatedAt": generated_at() if generated_at_value is None else generated_at_value,
        "profiles": profiles,
        "warnings": warnings,
        "environment": environment_snapshot or {},
    }
    encoded = json.dumps(bundle, ensure_ascii=True, separators=(",", ":"))
    header = f"/* Codex++ Environment Injector bundle v{VERSION} */\n"
    parts = [header + template_text.replace(token, encoded).rstrip(), studio_text.strip()]
    if react_ui_text.strip():
        parts.append(react_ui_text.strip())
    return "\n\n".join(parts) + "\n"


def load_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"failed to read {path}: {exc}") from exc
    return value if isinstance(value, dict) else {}


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(content, encoding="utf-8")
    os.replace(temp, path)


def backup_if_changed(path: Path, new_content: str) -> Path | None:
    if not path.exists():
        return None
    current = path.read_text(encoding="utf-8")
    if current == new_content:
        return None
    backup = path.with_name(path.name + f".bak-{timestamp()}")
    shutil.copy2(path, backup)
    return backup


def sync_userscript(
    codex_home: Path,
    appdata: Path,
    template_path: Path,
    includes: list[str] | None,
    dry_run: bool,
) -> int:
    profiles, warnings = discover_profiles(codex_home, includes)
    template_text = template_path.read_text(encoding="utf-8")
    studio_source_path = template_path.with_name("environment-studio.js")
    studio_text = studio_source_path.read_text(encoding="utf-8")
    react_ui_path = template_path.parent.parent / "build" / "react-ui.js"
    if not react_ui_path.exists():
        raise SyncError(f"React UI bundle is missing: {react_ui_path}; run npm run build:react")
    react_ui_text = react_ui_path.read_text(encoding="utf-8")
    snapshot = build_environment_snapshot(codex_home, warnings)
    rendered_script = render_userscript(template_text, studio_text, profiles, warnings, snapshot, react_ui_text)

    config_dir = appdata / "Codex++"
    script_path = config_dir / "user_scripts" / SCRIPT_NAME
    config_path = config_dir / "user_scripts.json"
    config = load_json_object(config_path)
    config["enabled"] = True
    scripts = config.get("scripts")
    if not isinstance(scripts, dict):
        scripts = {}
    scripts[SCRIPT_KEY] = True
    for legacy_key in LEGACY_SCRIPT_KEYS:
        if legacy_key in scripts:
            scripts[legacy_key] = False
    config["scripts"] = scripts
    config_text = json.dumps(config, ensure_ascii=False, indent=2, sort_keys=True) + "\n"

    print("Profiles: " + ", ".join(profile["id"] for profile in profiles))
    print(f"Environment injector: {script_path}")
    print(f"Registry: {config_path}")
    for warning in warnings:
        print(f"Notice: {warning}")
    if dry_run:
        print("DRY RUN: no files written")
        return 0

    script_backup = backup_if_changed(script_path, rendered_script)
    config_backup = backup_if_changed(config_path, config_text)
    atomic_write_text(script_path, rendered_script)
    atomic_write_text(config_path, config_text)
    if script_backup:
        print(f"Userscript backup: {script_backup}")
    if config_backup:
        print(f"Registry backup: {config_backup}")
    print("SYNCED: restart Codex through Codex++ or reload user scripts in Codex++ Manager")
    return 0


def uninstall_userscript(appdata: Path, dry_run: bool) -> int:
    config_dir = appdata / "Codex++"
    script_path = config_dir / "user_scripts" / SCRIPT_NAME
    config_path = config_dir / "user_scripts.json"
    config = load_json_object(config_path)
    scripts = config.get("scripts")
    if isinstance(scripts, dict):
        scripts.pop(SCRIPT_KEY, None)
        for legacy_name, legacy_key in zip(LEGACY_SCRIPT_NAMES, LEGACY_SCRIPT_KEYS):
            if (config_dir / "user_scripts" / legacy_name).exists():
                scripts[legacy_key] = True
        config["scripts"] = scripts
    market = config.get("market")
    if isinstance(market, dict):
        market.pop(SCRIPT_KEY, None)
        config["market"] = market
    config_text = json.dumps(config, ensure_ascii=False, indent=2, sort_keys=True) + "\n"

    print(f"Userscript: {script_path}")
    if dry_run:
        print("DRY RUN: no files removed")
        return 0
    backup_if_changed(config_path, config_text)
    atomic_write_text(config_path, config_text)
    if script_path.exists():
        backup = script_path.with_name(script_path.name + f".removed-{timestamp()}")
        os.replace(script_path, backup)
        print(f"Moved userscript to: {backup}")
    print("UNINSTALLED: restart Codex++ to remove the active page effect")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate, migrate, and register the Codex++ Environment Injector userscript."
    )
    parser.add_argument(
        "--codex-home",
        default=os.environ.get("CODEX_HOME") or str(Path.home() / ".codex"),
    )
    parser.add_argument(
        "--appdata",
        default=os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming"),
    )
    parser.add_argument(
        "--template",
        default=str(Path(__file__).resolve().parents[1] / "codexpp" / "environment-injector.template.js"),
    )
    parser.add_argument(
        "--profile",
        action="append",
        dest="profiles",
        help="Include only this profile name; may be repeated",
    )
    parser.add_argument("--dry-run", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("sync")
    subparsers.add_parser("uninstall")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    codex_home = Path(args.codex_home).expanduser().resolve()
    appdata = Path(args.appdata).expanduser().resolve()
    template = Path(args.template).expanduser().resolve()
    try:
        if args.command == "sync":
            return sync_userscript(
                codex_home,
                appdata,
                template,
                args.profiles,
                args.dry_run,
            )
        return uninstall_userscript(appdata, args.dry_run)
    except (OSError, SyncError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
