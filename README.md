# Codex Environment Injector / 环境注入器

A pluggable React 19 environment manager for Codex Desktop running through Codex++.

环境注入器用于为每个 Codex 会话选择并验证独立的模型、Provider、提示词、权限和 Memory 策略，同时提供全局 Memories / AGENTS 管理、注入证明与安全回滚。

## Features

- React 19 + TypeScript UI bundled into one userscript.
- Per-conversation environment selection before native New Chat.
- Model, Provider, reasoning effort, service tier, approval and sandbox settings.
- Developer Instructions and Base Instructions.
- Per-environment Memory read/generation policy: `inherit`, `on`, or `off`.
- Current-thread binding and redacted `acknowledged` proof.
- React Studio for file environments, local environments and reversible overrides.
- Global Memories review and scoped correction notes.
- Global `AGENTS.md` review, preview, hash conflict detection, backup and atomic commit.
- Legacy Profile Selector / Studio v1 data migration.
- Vanilla fallback UI if the React renderer fails or is manually destroyed.

## Information architecture

```text
Session / 会话
├─ Current conversation / 当前对话
└─ Next conversation / 下个对话

Global / 全局
├─ Memories
├─ AGENTS.md
└─ Environment management / 环境管理

Help / 帮助
└─ Tutorial / 使用教程
```

Session settings apply to a specific Codex thread. Memories, AGENTS and the environment catalog are global persisted data. Selecting an environment does not rewrite the global Codex `config.toml`.

## Architecture

```text
One installed userscript
├─ Framework-free headless core
│  ├─ v2 storage migration
│  ├─ native New Chat interception
│  ├─ prewarm / direct-RPC / dispatcher adapters
│  ├─ thread bindings and proof
│  └─ bridge client
├─ React 19 main panel
├─ React 19 Studio
└─ vanilla rollback UI
```

React and ReactDOM are bundled into the artifact. The plugin does not reuse Codex's private React instance and does not load runtime JS or CSS from the network.

The headless core remains independent from React. If the React root is destroyed, direct-RPC injection remains active and the vanilla fallback becomes visible again.

## Repository layout

```text
src/react/                         React main panel and Studio
codexpp/environment-injector.template.js
                                  headless runtime and fallback panel
codexpp/environment-studio.js     sidebar launcher and fallback Studio
build/react-ui.js                 generated React IIFE
bridge/codex-plus-core/            optional least-privilege Rust bridge
plugins/codex-environment-injector/
                                  native Codex plugin/skill
tools/                             generator
```

## Requirements

- Windows with Codex Desktop launched through Codex++.
- Node.js and npm on `PATH`.
- Python 3.11+ on `PATH`.
- Codex CLI on `PATH` for native plugin installation.

## Install

Clone the repository, then run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-ui.ps1
```

`install-ui.ps1`:

1. installs locked npm dependencies when required;
2. builds the React UI with esbuild;
3. discovers and sanitizes local `*.config.toml` environments;
4. builds a bounded redacted Memories/AGENTS snapshot;
5. generates one userscript;
6. enables the new script and disables legacy Profile Selector scripts.

Reload Codex++ userscripts or restart Codex through Codex++ after installation.

## Environment files

File environments are discovered from:

```text
%CODEX_HOME%\*.config.toml
```

Example `work.config.toml`:

```toml
model = "example-model"
model_provider = "example-provider"
model_reasoning_effort = "high"
developer_instructions = "Follow the selected environment workflow."
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[memories]
use_memories = false
generate_memories = false

[model_providers.example-provider]
base_url = "https://api.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
```

Credentials must remain in environment variables or operating-system credential storage. The generator removes secret-looking provider fields before embedding environments into the browser userscript.

## React development

```powershell
npm ci
npm run check:react
npm run build:react
npm run test:react
```

Run all non-live regression tests:

```powershell
node .\tests\test_environment_userscript.mjs
python -m unittest discover -s tests -p "test_*.py"
```

The React fragment is emitted to `build/react-ui.js`.

The generator combines the headless core, fallback Studio, React bundle and sanitized environment data into `dist/codex-environment-injector.js`.

## Runtime APIs

```javascript
window.__codexEnvironmentInjector?.status?.()
window.__codexEnvironmentStudio?.status?.()
window.__codexEnvironmentReactUi?.status?.()
```

Legacy Profile Selector / Studio globals remain compatibility aliases during migration.

## Injection safety

The injector never assigns `sendRequest` to a Codex `RpcTarget` instance. It installs compare-and-restore wrappers on owning descriptors for:

```text
prewarmThreadStart
sendRequest
dispatchMessage
```

The injector preserves receivers, trailing options, descriptor flags and original errors. Unload restores a descriptor only when the current value is still the injector-owned wrapper.

Proof records contain only environment identifiers, transport, redacted field names, timestamps, thread correlation and a SHA-256 digest. Raw prompts, complete request payloads and credentials are not persisted in proof storage.

## Optional native bridge

The optional Rust bridge source is located at `bridge/codex-plus-core/environment_injector.rs`.

It exposes only fixed Environment Injector targets for:

- global `AGENTS.md`;
- the Environment Injector ad-hoc memory correction note;
- owned backup listing and restore.

It does not expose arbitrary file access. Commits validate UTF-8 and size bounds, check an expected hash, create a timestamped backup and use an atomic write.

## Uninstall and rollback

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall-ui.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Uninstall preserves `codexpp.environmentInjector.v2` by default and restores legacy userscript registry entries when their files still exist. Generated userscript updates create timestamped backups before replacement.

## Privacy for public builds

Never publish a userscript generated from a real user Codex home. Generate `dist` against an empty temporary Codex home so it contains no local profiles, AGENTS content, Memories, paths, thread IDs or provider endpoints.

## License

MIT. See `LICENSE`.
