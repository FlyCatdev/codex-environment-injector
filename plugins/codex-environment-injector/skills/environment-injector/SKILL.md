---
name: environment-injector
description: "Manage, inject, inspect, migrate, and troubleshoot Codex conversation environments: Profiles, model/provider, prompt layers, Memories policy, AGENTS guidance, permissions, proof, installation, and rollback. Use when the user explicitly invokes $environment-injector or asks about the 环境注入器 UI or environment injection."
---

# 环境注入器

Use the Environment Injector as the preferred Codex++ environment control surface.

## Scope

An environment may contain:

- model and provider;
- reasoning effort and additional safe config;
- developer instructions and optional base instructions;
- approval policy, sandbox, and service tier;
- per-conversation Memory use/generation policy;
- source metadata and a sanitized revision;
- injection proof associated with a thread.

The centered UI provides:

- **选择环境** — select the next conversation environment;
- **当前会话** — inspect binding, planned prompt layers, config, transport, and redacted proof;
- **Memories** — review generated memory snapshots and maintain a correction draft;
- **AGENTS.md** — review the global guidance snapshot and maintain/export a draft.

The sidebar entry opens the environment editor for file-backed and local environments.

## Runtime safety

Never assign properties to an RPC target instance. In particular, never do:

```js
rpcTarget.sendRequest = wrapper
rpcTarget.__original = original
```

The direct-RPC adapter may replace only the inherited `sendRequest` descriptor on its owning prototype. It must:

1. heal a legacy own shadow only when it is configurable, enumerable, and exactly the same function as the non-enumerable inherited method;
2. require an inherited method owned by a prototype;
3. preserve the complete descriptor;
4. store originals externally or on the wrapper function, never on the target instance;
5. preserve receiver and remaining arguments;
6. handle only thread start/resume/fork;
7. restore the exact descriptor on unload.

The dispatcher adapter is compatibility fallback only.

## Injection proof

Use these states precisely:

- `planned` — an environment was selected;
- `dispatched` — patched parameters were forwarded;
- `acknowledged` — the patched direct request resolved and correlated to a thread id;
- `observed-unconfirmed` — a direct-RPC thread was observed but full injection was not proven;
- `failed` — the environment request failed.

Proof stores only environment id/revision, transport, redacted field names, timestamps, and a SHA-256 digest. It must never store raw prompts, config payloads, credentials, or authorization data.

Acknowledgment proves request forwarding and thread correlation. It does not expose Codex's final internally composed system prompt.

## Storage and migration

Canonical storage:

```text
localStorage["codexpp.environmentInjector.v2"]
```

Legacy inputs are imported once and retained for rollback:

```text
codexpp.profileSelector.v1
codexpp.profileStudio.v1
```

Migration must be idempotent. Do not delete legacy storage automatically.

The installed userscript key is:

```text
user:codex-environment-injector.js
```

During installation, legacy selector/studio scripts are disabled, not deleted. Uninstall restores them when their files still exist.

## Secrets

Recursively reject or redact keys and values resembling API keys, tokens, passwords, authorization, bearer credentials, auth contents, or URLs with embedded credentials. Do not import `.env`, `auth.json`, provider API keys, shell environment values, or referenced `model_instructions_file` content automatically.

The generated snapshot is read-only. Memory and AGENTS disk writes require dedicated least-privilege bridge capabilities, diff preview, expected hash, backup, atomic replace, and rollback. Never expose a general arbitrary-file route.

## Memories

Memories are contextual generated state, not the authoritative source for rules that must always apply.

Per-environment policy values are `inherit`, `on`, or `off` for both `use` and `generate`.

Without a writable bridge, the UI may save correction drafts and export/copy text, but must not claim it edited `~/.codex/memories`.

## AGENTS.md

Global stable personal rules belong in `%CODEX_HOME%/AGENTS.md`; project rules belong in the nearest project `AGENTS.md`.

Without a writable bridge, the UI may save/export a draft but must not claim it changed the source file.

## Install and refresh

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-ui.ps1
```

Then reload Codex++ user scripts or restart Codex through Codex++.

Read-only live status:

```javascript
window.__codexEnvironmentInjector?.status?.()
window.__codexEnvironmentStudio?.status?.()
```

Legacy compatibility facades may exist temporarily, but new code should use the canonical globals.

## Explicit global fallback

Use only when the user explicitly requests a process/global config overlay:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/environment-switch.ps1 list
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/environment-switch.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/environment-switch.ps1 activate work
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/environment-switch.ps1 deactivate
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/environment-switch.ps1 recover
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/environment-switch.ps1 doctor
```

Do not activate this fallback merely because a user selects an environment for one conversation.

## Required verification

Before claiming success, verify:

1. one new userscript is enabled and legacy scripts are disabled;
2. canonical v2 migration retained old keys;
3. the direct-RPC patch created no own `sendRequest` property;
4. thread parameters include the chosen environment fields;
5. the resolved thread has an `acknowledged` proof with digest;
6. unload restores exact descriptors;
7. the current-conversation UI reports the same thread/environment/proof;
8. no secret literal appears in generated bundle, logs, proof, or exported diagnostics.
