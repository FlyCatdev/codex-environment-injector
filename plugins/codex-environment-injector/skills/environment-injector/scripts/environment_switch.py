#!/usr/bin/env python3

import argparse
import datetime as dt
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import tomllib
from pathlib import Path
from typing import Any

VERSION = "0.3.2"
STATE_SCHEMA_VERSION = 1
PROFILE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
BARE_KEY_RE = re.compile(r"^[A-Za-z0-9_@-]+$")


class ProfileError(RuntimeError):
    pass


class ConflictError(ProfileError):
    def __init__(self, key_paths: list[str]):
        super().__init__("configuration changed after profile activation")
        self.key_paths = key_paths


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def timestamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def load_toml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("rb") as handle:
            value = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ProfileError(f"failed to parse TOML {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ProfileError(f"TOML root must be a table: {path}")
    return value


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProfileError(f"failed to read state {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ProfileError(f"state root must be an object: {path}")
    return value


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temp_path, path)


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_safe(value: Any, key_path: tuple[str, ...]) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [json_safe(item, key_path) for item in value]
    if isinstance(value, dict):
        return {
            str(key): json_safe(item, key_path + (str(key),))
            for key, item in value.items()
        }
    dotted = ".".join(key_path) or "<root>"
    raise ProfileError(
        f"unsupported TOML value type at {dotted}: {type(value).__name__}"
    )


def value_hash(value: Any) -> str:
    encoded = json.dumps(
        json_safe(value, ()),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def flatten_profile(
    value: dict[str, Any], prefix: tuple[str, ...] = ()
) -> list[tuple[tuple[str, ...], Any]]:
    flattened: list[tuple[tuple[str, ...], Any]] = []
    for key, item in value.items():
        path = prefix + (str(key),)
        if isinstance(item, dict):
            flattened.extend(flatten_profile(item, path))
        else:
            flattened.append((path, json_safe(item, path)))
    return flattened


def format_key_segment(segment: str) -> str:
    if BARE_KEY_RE.fullmatch(segment):
        return segment
    escaped = segment.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def format_key_path(segments: tuple[str, ...] | list[str]) -> str:
    return ".".join(format_key_segment(segment) for segment in segments)


def lookup(root: dict[str, Any], segments: tuple[str, ...] | list[str]) -> tuple[bool, Any]:
    current: Any = root
    for segment in segments:
        if not isinstance(current, dict) or segment not in current:
            return False, None
        current = current[segment]
    return True, json_safe(current, tuple(segments))


def values_match(
    left_exists: bool,
    left_value: Any,
    right_exists: bool,
    right_value: Any,
) -> bool:
    if left_exists != right_exists:
        return False
    if not left_exists:
        return True
    return value_hash(left_value) == value_hash(right_value)


def build_activation_plan(
    base_config: dict[str, Any], profile_config: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    request_edits: list[dict[str, Any]] = []
    state_edits: list[dict[str, Any]] = []
    for segments, applied_value in flatten_profile(profile_config):
        before_exists, before_value = lookup(base_config, segments)
        if before_exists and values_match(True, before_value, True, applied_value):
            continue
        key_path = format_key_path(segments)
        request_edits.append(
            {
                "keyPath": key_path,
                "value": applied_value,
                "mergeStrategy": "replace",
            }
        )
        state_edits.append(
            {
                "segments": list(segments),
                "keyPath": key_path,
                "beforeExists": before_exists,
                "appliedHash": value_hash(applied_value),
            }
        )
    return request_edits, state_edits


def build_restore_plan(
    current_config: dict[str, Any],
    backup_config: dict[str, Any],
    state_edits: list[dict[str, Any]],
    force: bool,
) -> tuple[list[dict[str, Any]], list[str]]:
    request_edits: list[dict[str, Any]] = []
    conflicts: list[str] = []
    for state_edit in state_edits:
        segments = tuple(str(part) for part in state_edit["segments"])
        key_path = str(state_edit["keyPath"])
        current_exists, current_value = lookup(current_config, segments)
        before_exists, before_value = lookup(backup_config, segments)

        current_is_before = values_match(
            current_exists, current_value, before_exists, before_value
        )
        current_is_applied = (
            current_exists
            and value_hash(current_value) == str(state_edit["appliedHash"])
        )

        if current_is_before:
            continue
        if not current_is_applied and not force:
            conflicts.append(key_path)
            continue

        request_edits.append(
            {
                "keyPath": key_path,
                "value": before_value if before_exists else None,
                "mergeStrategy": "replace",
            }
        )
    return request_edits, conflicts


def resolve_codex_home(explicit: str | None) -> Path:
    raw = explicit or os.environ.get("CODEX_HOME")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".codex").resolve()


def resolve_codex_binary(explicit: str | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    if os.environ.get("CODEX_CLI_PATH"):
        candidates.append(Path(os.environ["CODEX_CLI_PATH"]).expanduser())

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        desktop_bin = Path(local_app_data) / "OpenAI" / "Codex" / "bin"
        if desktop_bin.exists():
            candidates.extend(
                sorted(
                    desktop_bin.glob("*/codex.exe"),
                    key=lambda item: item.stat().st_mtime,
                    reverse=True,
                )
            )

    for command in ("codex.exe", "codex.cmd", "codex"):
        resolved = shutil.which(command)
        if resolved:
            candidates.append(Path(resolved))

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved.is_file():
            return resolved
    raise ProfileError("could not locate codex; pass --codex-bin explicitly")


def codex_command(codex_binary: Path, *arguments: str) -> list[str]:
    suffix = codex_binary.suffix.lower()
    if suffix in {".cmd", ".bat"}:
        return [
            os.environ.get("COMSPEC", "cmd.exe"),
            "/d",
            "/c",
            str(codex_binary),
            *arguments,
        ]
    if suffix == ".ps1":
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if not shell:
            raise ProfileError("PowerShell is required to run the codex.ps1 launcher")
        return [
            shell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(codex_binary),
            *arguments,
        ]
    return [str(codex_binary), *arguments]


def run_config_batch(
    codex_binary: Path,
    codex_home: Path,
    edits: list[dict[str, Any]],
) -> dict[str, Any]:
    if not edits:
        return {"status": "unchanged"}

    initialize = {
        "method": "initialize",
        "id": 1,
        "params": {
            "clientInfo": {
                "name": "codex_environment_injector",
                "title": "Codex Environment Injector",
                "version": VERSION,
            }
        },
    }
    initialized = {"method": "initialized", "params": {}}
    batch_write = {
        "method": "config/batchWrite",
        "id": 2,
        "params": {
            "edits": edits,
            "reloadUserConfig": True,
        },
    }

    environment = os.environ.copy()
    environment["CODEX_HOME"] = str(codex_home)
    command = codex_command(codex_binary, "app-server", "--stdio")
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    stderr_lines: list[str] = []
    output_queue: queue.Queue[str | None] = queue.Queue()

    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=environment,
            bufsize=1,
            creationflags=creation_flags,
        )
    except OSError as exc:
        raise ProfileError(f"failed to run codex app-server: {exc}") from exc

    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None

    def pump_stdout() -> None:
        try:
            for line in process.stdout:
                output_queue.put(line)
        finally:
            output_queue.put(None)

    def pump_stderr() -> None:
        for line in process.stderr:
            stderr_lines.append(line.rstrip())

    stdout_thread = threading.Thread(target=pump_stdout, daemon=True)
    stderr_thread = threading.Thread(target=pump_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    def send(message: dict[str, Any]) -> None:
        process.stdin.write(
            json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
        )
        process.stdin.flush()

    def wait_for_response(request_id: int, timeout_seconds: float) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProfileError(
                    f"timed out waiting for app-server response id {request_id}"
                )
            try:
                line = output_queue.get(timeout=remaining)
            except queue.Empty as exc:
                raise ProfileError(
                    f"timed out waiting for app-server response id {request_id}"
                ) from exc
            if line is None:
                detail = "\n".join(stderr_lines[-20:])
                raise ProfileError(
                    f"app-server exited before response id {request_id}"
                    + (f": {detail}" if detail else "")
                )
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict) and message.get("id") == request_id:
                return message

    try:
        send(initialize)
        initialize_response = wait_for_response(1, 30)
        if "error" in initialize_response:
            raise ProfileError(
                "codex rejected initialize: "
                + json.dumps(initialize_response["error"], ensure_ascii=False)
            )

        send(initialized)
        send(batch_write)
        response = wait_for_response(2, 60)
    except (OSError, ProfileError) as exc:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        if isinstance(exc, ProfileError):
            raise
        raise ProfileError(f"app-server I/O failed: {exc}") from exc
    finally:
        try:
            process.stdin.close()
        except OSError:
            pass

    if process.poll() is None:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    if "error" in response:
        raise ProfileError(
            "codex rejected the config transaction: "
            + json.dumps(response["error"], ensure_ascii=False)
        )
    result = response.get("result")
    if not isinstance(result, dict):
        raise ProfileError("codex returned an invalid config/batchWrite result")
    return result


def backup_config(config_path: Path, backup_dir: Path, label: str) -> Path | None:
    if not config_path.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"config.toml.{label}.{timestamp()}.bak"
    shutil.copy2(config_path, backup_path)
    return backup_path.resolve()


def profile_paths(codex_home: Path) -> list[Path]:
    return sorted(codex_home.glob("*.config.toml"), key=lambda path: path.name.lower())


def validate_profile_name(name: str) -> str:
    if not PROFILE_NAME_RE.fullmatch(name):
        raise ProfileError(
            "environment name must contain only letters, digits, underscore, or hyphen"
        )
    return name


def profile_name_from_path(path: Path) -> str:
    suffix = ".config.toml"
    return path.name[: -len(suffix)]


def state_paths(codex_home: Path) -> tuple[Path, Path, Path]:
    state_dir = codex_home / ".environment-injector"
    return state_dir, state_dir / "state.json", state_dir / "pending.json"


def read_active_state(codex_home: Path) -> dict[str, Any] | None:
    _, state_path, _ = state_paths(codex_home)
    if not state_path.exists():
        return None
    state = load_json(state_path)
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION:
        raise ProfileError("unsupported environment-injector state schema")
    return state


def load_backup_from_state(state: dict[str, Any]) -> dict[str, Any]:
    if not state.get("baseConfigExisted"):
        return {}
    backup_text = state.get("activationBackupPath")
    if not isinstance(backup_text, str) or not backup_text:
        raise ProfileError("active state does not contain a usable activation backup")
    backup_path = Path(backup_text)
    if not backup_path.exists():
        raise ProfileError(f"activation backup is missing: {backup_path}")
    return load_toml(backup_path)


def command_list(codex_home: Path) -> int:
    active = read_active_state(codex_home)
    active_name = str(active.get("profile")) if active else None
    paths = profile_paths(codex_home)
    if not paths:
        print(f"No profiles found under {codex_home}")
        return 0
    for path in paths:
        name = profile_name_from_path(path)
        try:
            config = load_toml(path)
            model = config.get("model", "-")
            provider = config.get("model_provider", "-")
            key_count = len(flatten_profile(config))
            marker = "*" if name == active_name else " "
            print(
                f"{marker} {name}: model={model}, provider={provider}, keys={key_count}"
            )
        except ProfileError as exc:
            print(f"! {name}: invalid ({exc})")
    return 0


def command_status(codex_home: Path) -> int:
    _, state_path, pending_path = state_paths(codex_home)
    if pending_path.exists():
        pending = load_json(pending_path)
        print(
            f"PENDING: activation for {pending.get('profile', '<unknown>')} requires recover"
        )
    if not state_path.exists():
        print("INACTIVE: Desktop is using the base config.toml")
        return 0

    state = read_active_state(codex_home)
    assert state is not None
    current = load_toml(codex_home / "config.toml")
    dirty: list[str] = []
    for edit in state.get("edits", []):
        segments = tuple(str(part) for part in edit["segments"])
        exists, value = lookup(current, segments)
        if not exists or value_hash(value) != edit["appliedHash"]:
            backup = load_backup_from_state(state)
            before_exists, before_value = lookup(backup, segments)
            if not values_match(exists, value, before_exists, before_value):
                dirty.append(str(edit["keyPath"]))

    print(f"ACTIVE: {state['profile']}")
    print(f"Activated: {state['activatedAt']}")
    print(f"Changed keys: {len(state.get('edits', []))}")
    print(f"Drifted keys: {len(dirty)}")
    for key_path in dirty:
        print(f"  {key_path}")
    print("Applies to new Desktop threads; restart the app if settings appear cached.")
    return 0


def command_activate(
    codex_home: Path,
    codex_binary: Path,
    name: str,
) -> int:
    name = validate_profile_name(name)
    state_dir, state_path, pending_path = state_paths(codex_home)
    if state_path.exists():
        active = read_active_state(codex_home)
        raise ProfileError(
            f"profile {active.get('profile')} is already active; deactivate it first"
        )
    if pending_path.exists():
        raise ProfileError("an interrupted activation exists; run recover first")

    profile_path = codex_home / f"{name}.config.toml"
    if not profile_path.exists():
        raise ProfileError(f"profile does not exist: {profile_path}")

    config_path = codex_home / "config.toml"
    base_config = load_toml(config_path)
    profile_config = load_toml(profile_path)
    request_edits, state_edits = build_activation_plan(base_config, profile_config)

    backup_path = backup_config(
        config_path,
        codex_home / "backups" / "environment-injector",
        f"before-activate-{name}",
    )
    state = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "profile": name,
        "profilePath": str(profile_path.resolve()),
        "profileSha256": sha256_file(profile_path),
        "baseConfigPath": str(config_path.resolve()),
        "baseConfigExisted": config_path.exists(),
        "baseConfigSha256Before": sha256_file(config_path),
        "activationBackupPath": str(backup_path) if backup_path else None,
        "activatedAt": utc_now(),
        "edits": state_edits,
    }
    write_json_atomic(pending_path, state)

    try:
        result = run_config_batch(codex_binary, codex_home, request_edits)
    except ProfileError as exc:
        raise ProfileError(
            f"activation did not complete cleanly: {exc}; run recover before retrying"
        ) from exc

    state_dir.mkdir(parents=True, exist_ok=True)
    os.replace(pending_path, state_path)
    print(f"ACTIVATED: {name}")
    print(f"Changed keys: {len(request_edits)}")
    if backup_path:
        print(f"Backup: {backup_path}")
    print(f"Codex write status: {result.get('status', 'ok')}")
    print("Open a new Desktop thread; restart Codex Desktop if settings appear cached.")
    return 0


def command_deactivate(
    codex_home: Path,
    codex_binary: Path,
    force: bool,
) -> int:
    state_dir, state_path, pending_path = state_paths(codex_home)
    if pending_path.exists():
        raise ProfileError("an interrupted activation exists; run recover first")
    state = read_active_state(codex_home)
    if state is None:
        print("INACTIVE: nothing to restore")
        return 0

    config_path = codex_home / "config.toml"
    current = load_toml(config_path)
    backup = load_backup_from_state(state)
    request_edits, conflicts = build_restore_plan(
        current,
        backup,
        list(state.get("edits", [])),
        force,
    )
    if conflicts:
        raise ConflictError(conflicts)

    rollback_backup = backup_config(
        config_path,
        codex_home / "backups" / "environment-injector",
        f"before-deactivate-{state['profile']}",
    )
    result = run_config_batch(codex_binary, codex_home, request_edits)

    history_dir = state_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    archived = dict(state)
    archived["deactivatedAt"] = utc_now()
    archived["forcedRollback"] = force
    archived["deactivationBackupPath"] = (
        str(rollback_backup) if rollback_backup else None
    )
    history_path = history_dir / f"{timestamp()}-{state['profile']}.json"
    write_json_atomic(history_path, archived)
    state_path.unlink(missing_ok=True)

    print(f"DEACTIVATED: {state['profile']}")
    print(f"Restored keys: {len(request_edits)}")
    if rollback_backup:
        print(f"Pre-rollback backup: {rollback_backup}")
    print(f"Codex write status: {result.get('status', 'ok')}")
    print("Open a new Desktop thread; restart Codex Desktop if settings appear cached.")
    return 0


def command_recover(codex_home: Path) -> int:
    _, state_path, pending_path = state_paths(codex_home)
    if state_path.exists():
        raise ProfileError("an active state already exists; recovery is not needed")
    if not pending_path.exists():
        print("No pending activation transaction.")
        return 0

    pending = load_json(pending_path)
    current = load_toml(codex_home / "config.toml")
    backup = load_backup_from_state(pending)
    all_applied = True
    all_before = True
    for edit in pending.get("edits", []):
        segments = tuple(str(part) for part in edit["segments"])
        current_exists, current_value = lookup(current, segments)
        before_exists, before_value = lookup(backup, segments)
        all_applied = all_applied and (
            current_exists and value_hash(current_value) == edit["appliedHash"]
        )
        all_before = all_before and values_match(
            current_exists, current_value, before_exists, before_value
        )

    if all_applied:
        os.replace(pending_path, state_path)
        print(f"RECOVERED ACTIVE: {pending.get('profile', '<unknown>')}")
        return 0
    if all_before:
        pending_path.unlink()
        print("RECOVERED INACTIVE: the interrupted write did not take effect")
        return 0
    raise ProfileError(
        "pending transaction is partially applied; restore its activation backup manually"
    )


def command_doctor(codex_home: Path, codex_binary: Path) -> int:
    print(f"CODEX_HOME: {codex_home}")
    print(f"config.toml: {'ok' if (codex_home / 'config.toml').exists() else 'missing'}")
    try:
        load_toml(codex_home / "config.toml")
        print("config parse: ok")
    except ProfileError as exc:
        print(f"config parse: failed ({exc})")
        return 2
    print(f"profiles: {len(profile_paths(codex_home))}")
    print(f"codex binary: {codex_binary}")
    try:
        completed = subprocess.run(
            codex_command(codex_binary, "--version"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            check=False,
        )
        version_text = completed.stdout.strip() or completed.stderr.strip()
        print(f"codex version: {version_text.splitlines()[-1] if version_text else 'unknown'}")
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"codex version: failed ({exc})")
        return 2
    command_status(codex_home)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Transactional profile-v2 overlay switcher for Codex Desktop."
    )
    parser.add_argument(
        "--codex-home",
        help="Codex home directory (default: CODEX_HOME or ~/.codex)",
    )
    parser.add_argument(
        "--codex-bin",
        help="Explicit codex executable or launcher path",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list", help="List named *.config.toml profiles")
    subparsers.add_parser("status", help="Show active profile and drift")
    activate = subparsers.add_parser("activate", help="Apply a profile to config.toml")
    activate.add_argument("name", help="Profile name without .config.toml")
    deactivate = subparsers.add_parser("deactivate", help="Restore pre-activation values")
    deactivate.add_argument(
        "--force",
        action="store_true",
        help="Overwrite keys that changed after activation",
    )
    subparsers.add_parser("recover", help="Resolve an interrupted activation")
    subparsers.add_parser("doctor", help="Check runtime and state health")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    codex_home = resolve_codex_home(args.codex_home)
    codex_home.mkdir(parents=True, exist_ok=True)

    try:
        if args.command == "list":
            return command_list(codex_home)
        if args.command == "status":
            return command_status(codex_home)
        if args.command == "recover":
            return command_recover(codex_home)

        codex_binary = resolve_codex_binary(args.codex_bin)
        if args.command == "activate":
            return command_activate(codex_home, codex_binary, args.name)
        if args.command == "deactivate":
            return command_deactivate(codex_home, codex_binary, args.force)
        if args.command == "doctor":
            return command_doctor(codex_home, codex_binary)
        parser.error(f"unknown command: {args.command}")
    except ConflictError as exc:
        print("CONFLICT: the following keys changed after activation:", file=sys.stderr)
        for key_path in exc.key_paths:
            print(f"  {key_path}", file=sys.stderr)
        print("Run deactivate --force only if overwriting those changes is intended.", file=sys.stderr)
        return 3
    except ProfileError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
