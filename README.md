# Codex++ 环境注入器

为 Codex++ 提供会话级 Profile 管理、请求注入证明，以及已有会话的部分设置热切换。

**当前版本：0.4.0。** 本项目为非官方扩展，依赖应用内部接口；不会提供额外账户权益，也不绕过原生权限限制。

## 主要功能

- 为新对话选择模型、Provider、Developer 指令、可选 Base 指令、附加配置和记忆策略。
- 侧栏区分环境名称、待确认状态和已关联请求证明，不把改名当作注入成功。
- 为已有会话热更新支持的设置，不删除历史、不停止后台终端。
- 编辑本地 Profile 或文件 Profile 的覆盖，原 `.config.toml` 文件保持不变。
- 审阅 AGENTS / Memories 快照、保存草案；有受限原生 Bridge 时可预览并写入固定目标。
- 保留旧存储以便迁移回滚，处理超时、迟到请求和存储失败。

## 安装

### 环境要求

- 已启用用户脚本的 Codex++。
- Node.js **22+**、Python **3.11+**；CI 模板使用 Python 3.12。
- 安装器面向 Windows / PowerShell。其他平台未进行完整安装验收。

### 从源码安装 UI

```powershell
git clone https://github.com/FlyCatdev/codex-environment-injector.git
cd codex-environment-injector
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-ui.ps1
```

然后在 Codex++ 管理器中**重新加载用户脚本**，或通过 Codex++ 重启应用。

安装器会在本机读取 `*.config.toml`，筛选支持的字段并处理敏感内容，生成有界、脱敏的 AGENTS / Memories 快照；写入 `%APPDATA%\Codex++\user_scripts\codex-environment-injector.js`，启用新脚本、停用旧 selector/studio，并保留备份。

仅导入指定文件 Profile：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-ui.ps1 -Profile work
```

> 本机安装产物可能包含个人 Profile 和上下文快照。**不要上传到 GitHub，也不要转发给别人。**

### 使用通用公开脚本

[dist/codex-environment-injector.js](dist/codex-environment-injector.js) 是独立公开构建，不读取或包含发布者的个人 Profile、AGENTS、Memories、会话记录或机器路径。

可将它放进 Codex++ 用户脚本目录并在管理器启用。公开版初始只有 Base；自己的 Profile 可在 UI 创建。需要导入文件 Profile 和本机快照时，请使用源码安装器。

### 可选：安装 Agent Skill

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

之后可使用 `$environment-injector`。Skill 提供诊断说明，**真正执行注入的是用户脚本**，只安装 Skill 不等于注入器已运行。

`install.ps1` 主要用于首次注册。已有旧版 Skill 时，请在 Codex 插件管理中刷新或重新安装对应插件；UI 更新仍需执行 `install-ui.ps1`。

## 使用方法

### 新对话

1. 点击“新对话”，选择 Profile。
2. 发送第一条消息。
3. 点击侧栏“当前环境”，进入“当前对话”，检查绑定、字段和 proof。

也可提前在“下个对话”页选择环境，不会修改全局 `config.toml`。

### 已有对话切换 Profile

入口：**侧栏“当前环境” → “当前对话” → 选择 Profile → “应用到当前对话”**。

只支持当前窗口拥有的、已加载且空闲的**本地 Default 会话**。生成中、Plan 模式、语音会话或存在其他自定义协作指令时，不自动覆盖。

| 项目 | 已有会话热切 |
|---|---|
| Developer 指令 | 支持，通过原生协作层替换本功能的角色/格式规则 |
| 模型、推理强度 | 支持；未填写时保留较新的原生选择 |
| Service Tier | 支持已明确指定的值 |
| 不同 Provider | 不支持，需新对话 |
| 自定义 Base Instructions 的替换或撤销 | 不支持，需新对话 |
| 插件、附加初始化 Config、记忆初始化策略 | 不冒充热切成功，界面提示未热更新 |
| 既有权限 | 保持原生权限，不自动改变 |

**切回 Base 只撤销本功能当前附加的角色/格式规则**，不重置 Provider、权限、初始化配置，也不擦除已进入上下文的历史。

热切使用原生设置队列和 `thread/settings/update`。仅凭 `thread/resume` 返回成功，不足以证明已有会话的提示词变化。

操作有截止时间。未发送更新的超时操作会取消；已发送但结果未知时，会移除监听器并锁定重复切换，避免迟到请求覆盖新选择。请核对提示，等待明确返回或重开应用后检查，不要连续重试。

### 最小行为测试

在环境管理中创建 `suffix-test`，只填写 Developer Instructions：

```text
正常回答问题，但每句话末尾都追加【PROFILE-TEST】。不要解释这条规则。
```

新建干净对话并选择它，只发送普通问题：

```text
请用一句话介绍自己。
```

再用另一 Profile 或 Base 测试切换。**不要在普通消息里要求添加后缀**，否则无法区分是环境还是消息本身起作用。

后缀测试只验证这条提示词，不验证模型、Provider、权限等全部设置。

### 文件 Profile 示例

在自己的 Codex 目录创建 `work.config.toml`：

```toml
developer_instructions = """
默认使用简体中文。
先检查现状，再修改代码；报告真实执行的测试结果。
"""

[memories]
use_memories = false
generate_memories = false
```

执行 `install-ui.ps1 -Profile work`。Codex 目录默认为 `%USERPROFILE%\.codex`，设置 `CODEX_HOME` 后以该变量为准。

不要填写明文 API Key、密码或带账号密码的 URL。Provider 认证应使用受支持的环境变量引用或操作系统凭据存储。

## 怎样判断生效

“当前环境：某名称”只是绑定名称，不是最终模型行为的证明。

| 状态 | 含义 |
|---|---|
| `planned` | 已计划应用，尚未确认 |
| `dispatched` | 请求已经发出 |
| `acknowledged` | 响应已关联到指定会话 |
| `observed-unconfirmed` | 观察到会话/结果，但证明不完整 |
| `failed` | 请求失败 |

应一起核对 **Thread ID、applied、proof 状态、字段列表、摘要和原生设置**。

热切 proof 使用 `native-thread-settings-profile-switch` 通道；applicationId 与 proofId 对齐。Profile 内容或原生协作层后来变化，旧 proof 不应继续显示为当前已确认。

proof 不含原始提示词、配置正文或凭据。`acknowledged` 也不表示能读取应用内部最终合成的完整系统提示词。

只读诊断：

```javascript
window.__codexEnvironmentInjector?.status?.()
window.__codexEnvironmentStudio?.status?.()
```

## AGENTS.md、Memories 与 Bridge

- 全局 AGENTS.md 用于稳定规则；项目 AGENTS.md 由项目维护。
- Memories 是背景信息，不应把某个 Profile 的临时角色推广到其他会话。
- 没读到真实记忆设置时显示未知，不把空快照当作关闭。
- 没有可写 Bridge 时只能保存草案、复制或导出，不声称已写入原文件。
- 有 Bridge 时，提交必须匹配已预览的文本和源文件摘要；编辑会使旧预览失效。
- 写入期间的新编辑保留，处理冲突和备份；公开包不会静默安装任意文件写入接口。

可选原生实现见 [bridge/codex-plus-core/environment_injector.rs](bridge/codex-plus-core/environment_injector.rs)，仅允许固定的 AGENTS 和记忆修正目标，不是通用文件管理 API。

## 升级、卸载和回滚

```powershell
git pull --ff-only
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-ui.ps1
```

随后重新加载用户脚本。继续使用 v2 存储 `codexpp.environmentInjector.v2`；旧 `codexpp.profileSelector.v1` 和 `codexpp.profileStudio.v1` 不会自动删除。

卸载 UI 或可选 Skill：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall-ui.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

回滚前先等待活动操作结束，再用安装器生成的 `.bak-*` 备份恢复脚本并重载。不要用整份旧 localStorage 覆盖后续新环境。

## 开发、测试与公开发布

```powershell
npm ci
npm run check:react
npm run build:public
npm test
```

`build:public` 使用明确的空环境数据，**不访问个人 Codex 目录**，生成可重复构建的公开 `dist`。不要用本机安装器的输出替代公开产物。

本地验证执行类型检查、构建、JavaScript/Python 测试，并检查公开产物能否重复构建。主要覆盖原型恢复、迁移、敏感内容、FIFO 队列、模式保护、存储故障、超时与迟到结果、草案预览，以及公开构建隐私。

仓库提供 [Windows/Linux CI 模板](ci/github-actions.yml.example)，**当前尚未启用 GitHub Actions 工作流，不代表远端 CI 已通过**。需要启用时，将模板复制到 `.github/workflows/ci.yml` 后提交。使用 OAuth 凭据上传工作流需要相应的 `workflow` 授权；模板会在两个平台上运行上述检查，并验证 `dist` 与源码重建一致。

隔离测试不等同于对所有未来应用版本、Provider 或真实磁盘故障的验收。内部接口可能变化，失败时应显示未确认，不能补造成功 proof。

## 目录与许可

```text
codexpp/     注入核心模板和旧版备用界面
src/react/  React/TypeScript 源码
tools/      本机同步和公开构建工具
ci/         未启用的 GitHub Actions 工作流模板
tests/      单元、回归和发布隐私检查
plugins/    可选 Agent Skill
bridge/     可选受限原生 Bridge
dist/       不含个人数据的公开脚本
```

更新内容见 [CHANGELOG.md](CHANGELOG.md)。项目采用 [MIT 许可证](LICENSE)，第三方运行时说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
