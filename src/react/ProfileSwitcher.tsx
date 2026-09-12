import React, { useEffect, useRef, useState } from 'react'
import type { CoreApi, UiSnapshot } from './types'

export function CurrentProfileSwitcher({ api, core }: { api: CoreApi; core: UiSnapshot }) {
  const threadId = core.status.currentThreadId
  const [selected, setSelected] = useState(core.currentProfile?.id || 'base')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const current = useRef(threadId)
  current.current = threadId
  useEffect(() => {
    setSelected(core.currentProfile?.id || 'base')
    setBusy(false)
    setMessage('')
  }, [threadId])
  const availability = core.status.currentSwitch
  const apply = async () => {
    const target = core.profiles.find(profile => profile.id === selected)
    if (!threadId || !target || busy || availability?.busy) return
    if (!window.confirm(`将本会话的热切项应用为“${target.name}”？更新 Developer、模型、推理和 Service Tier；历史及后台服务保留，初始化配置不热切。${target.modelProvider ? `Profile 指定 Provider：${target.modelProvider}；仅允许与当前相同。` : ''}`)) return
    setBusy(true)
    setMessage('正在更新原生会话设置…')
    try {
      const result = await api.switchThreadProfile(threadId, target.id)
      if (current.current === threadId) setMessage(result.message)
    } catch (error) {
      if (current.current === threadId) setMessage(error instanceof Error ? error.message : '切换未确认，请检查会话设置')
    } finally {
      if (current.current === threadId) setBusy(false)
    }
  }
  if (!threadId) return null
  return <section className="ei-card">
    <strong>切换当前对话的 Profile</strong>
    <div className="ei-actions">
      <select className="ei-studio-input" value={selected} disabled={busy || availability?.busy}
        onChange={event => setSelected(event.target.value)} aria-label="当前对话目标 Profile">
        {core.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
      <button className="ei-button ei-button-primary" type="button"
        disabled={busy || availability?.busy || !availability?.available} onClick={() => void apply()}>
        {busy || availability?.busy ? '正在切换…' : '应用到当前对话'}
      </button>
    </div>
    <p className="ei-help">仅支持 Default 模式的空闲会话。Base 撤销本功能的附加角色规则；Provider、Base Instructions、插件和记忆初始化配置需新会话。现有权限保持不变。</p>
    <p className="ei-status">{message || availability?.result?.message || availability?.reason || ''}</p>
  </section>
}
