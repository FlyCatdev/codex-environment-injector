import React, { Component, useEffect, useState, useSyncExternalStore } from 'react'
import type { ErrorInfo, PropsWithChildren, ReactNode } from 'react'
import type { CoreApi, EnvironmentProfile, PanelMode, UiSnapshot } from './types'
import { ReactUiStore } from './store'
import { StudioDialog } from './Studio'
import { CurrentProfileSwitcher } from './ProfileSwitcher'
import { useDraftEditor } from './useDraftEditor'

function useUi(store: ReactUiStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

class UiErrorBoundary extends Component<PropsWithChildren<{ onError(message: string): void }>, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(`${error.message}\n${info.componentStack || ''}`)
  }

  render() {
    if (this.state.failed) {
      return <div className="ei-card">React UI 加载失败；headless 注入核心仍在运行。重新加载 Userscript 可恢复旧版备用 UI。</div>
    }
    return this.props.children
  }
}

function profileDetail(profile: EnvironmentProfile) {
  const parts: string[] = []
  if (profile.id === 'base') parts.push('全局基础配置')
  else if (profile.source === 'file') parts.push('文件环境')
  else if (profile.source === 'studio-override') parts.push('本地覆盖')
  else parts.push('本地环境')
  if (profile.model) parts.push(profile.model)
  if (profile.modelProvider) parts.push(profile.modelProvider)
  return parts.join(' · ')
}

function Button({ children, primary = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button className={`ei-button${primary ? ' ei-button-primary' : ''}`} type="button" {...props}>{children}</button>
}

function ScopeHeader({ scope, title, detail }: { scope: '会话级' | '全局' | '帮助'; title: string; detail: string }) {
  return <header className="ei-scope-header"><span data-scope={scope}>{scope}</span><div><h3>{title}</h3><p>{detail}</p></div></header>
}

function MetaGrid({ rows, className = '' }: { rows: Array<[string, unknown]>; className?: string }) {
  return <div className={`ei-meta${className ? ` ${className}` : ''}`}>{rows.map(([label, value]) => (
    <div className="ei-meta-row" key={label}><span>{label}</span><code title={String(value || '')}>{String(value || '继承 / 未设置')}</code></div>
  ))}</div>
}

function Disclosure({ title, text, empty = '未设置', defaultOpen = false, children, meta }: {
  title: string
  text?: string
  empty?: string
  defaultOpen?: boolean
  children?: ReactNode
  meta?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const lines = text ? Math.max(1, text.split('\n').length) : 0
  const resolvedMeta = meta || (children ? '查看' : lines ? `${lines} 行` : '未设置')
  return <section className="ei-disclosure" data-open={open}>
    <button className="ei-disclosure-trigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>{title}</span>
      <span className="ei-disclosure-end"><span className="ei-disclosure-meta">{resolvedMeta}</span><span className="ei-chevron" aria-hidden>⌄</span></span>
    </button>
    {open ? <div className="ei-disclosure-body">{children ?? <pre className="ei-pre" data-empty={!text}>{text || empty}</pre>}</div> : null}
  </section>
}

function SelectEnvironmentView({ store, core, title }: { store: ReactUiStore; core: UiSnapshot; title: string }) {
  return <>
    <ScopeHeader scope="会话级" title={title === '选择环境' ? '下个对话' : title} detail="选择只应用到即将创建的会话，不修改全局配置。" />
    <div className="ei-profile-list">
      {core.profiles.map((profile) => {
        const selected = core.status.pendingProfileId === profile.id
        return <button className="ei-profile" data-profile-id={profile.id} data-selected={selected} aria-pressed={selected} key={profile.id} type="button" onClick={() => store.selectProfile(profile.id)}>
          <span className="ei-profile-copy"><strong>{profile.name}</strong><small>{profileDetail(profile)}</small></span>
          <span className="ei-check">{selected ? '✓' : ''}</span>
        </button>
      })}
    </div>
    <label className="ei-scope-toggle"><input type="checkbox" checked={core.status.promptOnNewThread !== false} onChange={(event) => store.setPromptOnNewThread(event.target.checked)} /><span>每次新对话都询问</span></label>
  </>
}

function bindingStatus(core: UiSnapshot) {
    const status = core.status;
    if (!status.currentThreadId) return { kind: "draft", label: "新对话草稿", detail: "尚未创建 thread；选择环境后发送第一条消息即可验证。" };
    const binding = status.currentProfileBinding;
    if (!binding) return { kind: "base", label: "未由选择器管理", detail: "该会话没有环境绑定记录，按 Base / Codex 全局配置运行。" };
    const proof = status.currentProof;
    if (binding.applied === true && proof?.status === "acknowledged" && proof.matchesCurrentProfile === true
        && binding.proofId && binding.proofId === proof.proofId
        && /^sha256:[0-9a-f]{64}$/i.test(proof.payloadDigest || ""))
      return { kind: "confirmed", label: "请求转发已确认", detail: "环境参数已转发并关联到该会话；最终模型行为仍需独立测试。" };
    if (binding.applied === true) return { kind: "unconfirmed", label: "当前版本未确认", detail: "证明缺失、正在校验或对应旧版环境；编辑后的内容尚未确认转发。" };
    if (binding.applied === false) return { kind: "unconfirmed", label: "已选择 · 未确认", detail: "已观察到会话，但尚无 acknowledged proof。" };
    return { kind: "unknown", label: "旧版绑定", detail: "历史记录没有保存明确注入状态。" };
  }
function InspectorTabs({ items }: { items: Array<{ id: string; label: string; text: string; empty: string }> }) {
  const initial = items.find((item) => item.text)?.id || items[0]?.id || ''
  const [active, setActive] = useState(initial)
  const selected = items.find((item) => item.id === active) || items[0]
  return <section className="ei-inspector">
    <div className="ei-inspector-tabs">{items.map((item) => <button type="button" key={item.id} aria-selected={selected?.id === item.id} onClick={() => setActive(item.id)}>{item.label}{item.text ? <span>{Math.max(1, item.text.split('\n').length)}</span> : null}</button>)}</div>
    <pre className="ei-pre" data-empty={!selected?.text}>{selected?.text || selected?.empty || '未设置'}</pre>
  </section>
}

function CurrentSessionView({ core, api }: { core: UiSnapshot; api: CoreApi }) {
  const profile = core.currentProfile || core.profiles[0]
  const status = bindingStatus(core)
  const proof = core.status.currentProof
  const reasoning = String((profile?.config as any)?.model_reasoning_effort || '')
  const runtimeSummary = [profile?.model, profile?.modelProvider, reasoning, profile?.sandbox].filter(Boolean).join(' · ') || '使用 Codex 全局配置'
  const configText = profile?.config && Object.keys(profile.config).length ? JSON.stringify(profile.config, null, 2) : ''
  const proofText = proof ? JSON.stringify(proof, null, 2) : ''
  return <>
    <ScopeHeader scope="会话级" title="当前对话" detail="展示环境计划、当前热切状态和注入证明。" />
    <CurrentProfileSwitcher api={api} core={core} />
    <section className="ei-current-summary">
      <div className="ei-current-title"><span className="ei-status-dot" data-kind={status.kind} /><strong>{profile?.name || 'Base'}</strong><span className="ei-current-status">{status.label}</span></div>
      <p>{runtimeSummary}</p>
      {core.status.currentThreadId ? <code className="ei-thread">{core.status.currentThreadId}</code> : <span className="ei-help">{status.detail}</span>}
    </section>
    <Disclosure title="运行详情" meta="策略与证明">
      <MetaGrid className="ei-meta-flat" rows={[
        ['环境 ID', profile?.id || 'base'], ['审批', profile?.approvalPolicy || '继承'], ['Service tier', profile?.serviceTier || '继承'],
        ['Memory', `${profile?.memoryPolicy?.use || '继承'} / ${profile?.memoryPolicy?.generate || '继承'}`],
        ['Proof', proof?.status || '未绑定'], ['Transport', proof?.transport || core.status.currentProfileBinding?.source || 'Base'],
      ]} />
    </Disclosure>
    <InspectorTabs items={[
      { id: 'developer', label: 'Developer', text: profile?.developerInstructions || '', empty: '未设置 Developer Instructions' },
      { id: 'base', label: 'Base', text: profile?.baseInstructions || '', empty: '未设置 Base Instructions' },
      { id: 'config', label: 'Config', text: configText, empty: '空配置' },
      { id: 'proof', label: 'Proof', text: proofText, empty: '当前会话没有注入证明' },
    ]} />
    <p className="ei-note">仅展示环境计划与确认记录；Codex 最终合成提示词属于内部运行态。</p>
  </>
}

function MemoryView({ api, store, core }: { api: CoreApi; store: ReactUiStore; core: UiSnapshot }) {
  const memory = (core.bridgeMemory || core.environmentSnapshot.memory || {}) as any
  const settings = (core.environmentSnapshot.memory as any)?.settings || {}
  const source = memory.correction || {}
  const writable = core.status.capabilities?.diskWrite === true
  const { draft, preview, message, runPreview, commit, edit } = useDraftEditor({
    api, store, source, persistedDraft: core.environmentStore.ui.memoryCorrectionDraft, draftKey: 'memoryCorrectionDraft',
    previewPath: '/environment-injector/memory/preview-correction', commitPath: '/environment-injector/memory/commit-correction', label: 'Memory 修正 Note',
  })

  return <>
    <ScopeHeader scope="全局" title="Memories" detail="全局记忆存储；单个环境可覆盖是否读取或生成。" />
    <MetaGrid rows={[
      ['总开关', settings.enabled === true ? '开启' : settings.enabled === false ? '关闭' : '未知 / 未读取'], ['读取记忆', String(settings.use_memories ?? '继承')], ['生成记忆', String(settings.generate_memories ?? '继承')],
      ['写入能力', writable ? 'Bridge 可写' : '只读 / 草案'], ['文件', Array.isArray(memory.files) ? `${memory.files.length} 个` : '未知'],
    ]} />
    <Disclosure title="Memory Summary" text={memory.summary?.content} defaultOpen />
    <Disclosure title="Durable MEMORY.md" text={memory.durable?.content} />
    <section className="ei-card">
      <strong>记忆修正草案</strong>
      <p className="ei-help">只写稳定事实和纠正项；不会直接改写生成的 MEMORY.md。</p>
      <textarea className="ei-textarea" value={draft} onChange={(event) => edit(event.target.value)} />
      <div className="ei-actions">
        <Button onClick={() => { api.updateUiPreferences({ memoryCorrectionDraft: draft }); store.showToast('草案已保存') }}>保存草案</Button>
        <Button disabled={!writable} onClick={() => void runPreview()}>预览写入</Button>
        <Button primary disabled={!preview} onClick={() => void commit()}>确认写入</Button>
      </div>
      <Disclosure title="写入内容对比" text={preview?.comparison} defaultOpen />
      <p className="ei-status" data-kind={preview ? 'success' : undefined}>{message}</p>
    </section>
  </>
}

function AgentsView({ api, store, core }: { api: CoreApi; store: ReactUiStore; core: UiSnapshot }) {
  const agents = (core.bridgeAgents || core.environmentSnapshot.globalAgents || {}) as any
  const writable = core.status.capabilities?.diskWrite === true
  const { draft, preview, message, runPreview, commit, edit } = useDraftEditor({
    api, store, source: agents, persistedDraft: core.environmentStore.ui.agentsDraft, draftKey: 'agentsDraft',
    previewPath: '/environment-injector/agents/preview', commitPath: '/environment-injector/agents/commit', label: 'AGENTS.md',
  })

  return <>
    <ScopeHeader scope="全局" title="AGENTS.md" detail="所有项目共享的稳定规则；项目目录中的 AGENTS.md 优先级更高。" />
    <MetaGrid rows={[
      ['状态', agents.exists ? '已存在' : '未创建'], ['大小', Number.isFinite(agents.size) ? `${agents.size} bytes` : '—'], ['Hash', agents.hash || '—'],
      ['写入能力', writable ? 'Bridge 可写' : '草案 / 导出'],
    ]} />
    <section className="ei-card">
      <strong>AGENTS.md 草案</strong>
      <textarea className="ei-textarea ei-textarea-tall" value={draft} onChange={(event) => edit(event.target.value)} />
      <div className="ei-actions">
        <Button onClick={() => { api.updateUiPreferences({ agentsDraft: draft }); store.showToast('AGENTS.md 草案已保存') }}>保存草案</Button>
        <Button onClick={() => navigator.clipboard.writeText(draft).then(() => store.showToast('已复制'))}>复制</Button>
        <Button disabled={!writable} onClick={() => void runPreview()}>预览写入</Button>
        <Button primary disabled={!preview} onClick={() => void commit()}>确认写入</Button>
      </div>
      <Disclosure title="写入内容对比" text={preview?.comparison} defaultOpen />
      <p className="ei-status" data-kind={preview ? 'success' : undefined}>{message}</p>
    </section>
  </>
}

const tutorialSections: Array<[string, string[]]> = [
  ['如何创建或修改环境', ['打开左侧“环境注入器”编辑文件环境或本地环境。', '文件环境保存为本地覆盖，原文件不变。', '模型、Provider、提示词、权限和 Memory 策略均按环境保存。']],
  ['如何判断注入是否生效', ['当前会话必须同时有 Thread ID、applied=true 和 acknowledged proof。', 'prewarm 或 app-server request client transport 代表真实生命周期通道。', 'observed-unconfirmed 不能当作成功。']],
  ['Memories 应该怎么用', ['Memories 保存稳定事实，不保存环境角色。', '隔离环境时将读取和生成设为 off。', '修正只写 ad-hoc Note，不直接覆盖生成记忆。']],
  ['AGENTS.md、预览和恢复', ['稳定工作规则放全局 AGENTS.md。', '写入前必须预览并校验 expected hash。', '每次提交先备份，冲突时重新加载。']],
  ['常见故障', ['没弹选择器：检查“新对话创建前询问”。', '未确认注入：检查 adapter 与 requestTrace。', 'Bridge 只读：检查 capabilities.diskWrite。', 'RpcTarget 错误：禁止实例属性赋值。']],
]

function TutorialView({ store }: { store: ReactUiStore }) {
  const steps = [
    ['1', '点击新对话', '在 Codex 创建 thread 前选择环境。'],
    ['2', '选择环境', '模型、Provider 和提示词只影响这次会话。'],
    ['3', '发送消息', '核心拦截 prewarm/thread/start。'],
    ['4', '检查 proof', '确认 applied=true 与 acknowledged。'],
  ]
  return <>
    <ScopeHeader scope="帮助" title="使用教程" detail="了解会话环境、全局数据、注入证明和安全恢复。" />
    <div className="ei-steps">{steps.map(([number, title, detail]) => <article className="ei-step" key={number}><span className="ei-step-number">{number}</span><div><h4>{title}</h4><p>{detail}</p></div></article>)}</div>
    {tutorialSections.map(([title, paragraphs], index) => <Disclosure title={title} defaultOpen={index === 0} key={title}><div className="ei-tutorial-copy">{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></Disclosure>)}
    <div className="ei-actions"><Button primary onClick={() => store.openStudio()}>打开环境编辑器</Button><Button onClick={() => store.openMode('current')}>查看当前会话</Button></div>
  </>
}

const navigationGroups: Array<{ label: string; items: Array<{ mode?: PanelMode; label: string; action?: 'studio' }> }> = [
  { label: '会话', items: [{ mode: 'current', label: '当前对话' }, { mode: 'select', label: '下个对话' }] },
  { label: '全局', items: [{ mode: 'memory', label: 'Memories' }, { mode: 'agents', label: 'AGENTS.md' }, { label: '环境管理', action: 'studio' }] },
  { label: '帮助', items: [{ mode: 'tutorial', label: '使用教程' }] },
]

function ScopeNavigation({ mode, store }: { mode: PanelMode; store: ReactUiStore }) {
  return <aside className="ei-scope-nav" aria-label="环境注入器导航">{navigationGroups.map((group) => <section className="ei-scope-nav-group" key={group.label}><span>{group.label}</span>{group.items.map((item) => <button type="button" key={item.label} aria-current={item.mode === mode ? 'page' : undefined} onClick={() => item.action === 'studio' ? store.openStudio() : item.mode && store.openMode(item.mode)}>{item.label}</button>)}</section>)}</aside>
}

export function InjectorApp({ api, store }: { api: CoreApi; store: ReactUiStore }) {
  const state = useUi(store)
  const expanded = state.core.environmentStore.ui.panelExpanded === true

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (state.studioOpen) store.closeStudio()
      else if (state.open) store.close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state.open, state.studioOpen, store])

  return <UiErrorBoundary onError={(message) => store.showToast(message, 'error')}>
    <div className="ei-shell">
      {state.open ? <div className="ei-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) store.close() }}>
        <section className="ei-dialog" data-mode={state.mode} data-expanded={expanded} role="dialog" aria-modal="true" aria-label="环境注入器">
          <header className="ei-header ei-main-header" onDoubleClick={(event) => { if (!(event.target as Element).closest('button')) store.setExpanded(!expanded) }}>
            <div className="ei-header-copy"><h2>环境注入器</h2><p>会话环境与全局上下文</p></div>
            <div className="ei-header-actions"><button className="ei-icon-button" type="button" title={expanded ? '恢复面板大小' : '最大化面板'} aria-label={expanded ? '恢复面板大小' : '最大化面板'} onClick={() => store.setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button><button className="ei-icon-button" type="button" aria-label="关闭" onClick={() => store.close()}>×</button></div>
          </header>
          <div className="ei-main-layout">
            <ScopeNavigation mode={state.mode} store={store} />
            <main className={`ei-body${state.mode === 'current' ? ' ei-body-current' : ''}`}>
              {state.mode === 'select' ? <SelectEnvironmentView store={store} core={state.core} title={state.title} /> : null}
              {state.mode === 'current' ? <CurrentSessionView core={state.core} api={api} /> : null}
              {state.mode === 'memory' ? <MemoryView api={api} store={store} core={state.core} /> : null}
              {state.mode === 'agents' ? <AgentsView api={api} store={store} core={state.core} /> : null}
              {state.mode === 'tutorial' ? <TutorialView store={store} /> : null}
            </main>
          </div>
        </section>
      </div> : null}
      {state.studioOpen ? <StudioDialog api={api} store={store} core={state.core} /> : null}
      {state.toast ? <div className="ei-toast" data-kind={state.toast.kind} key={state.toast.nonce}>{state.toast.message}</div> : null}
    </div>
  </UiErrorBoundary>
}
