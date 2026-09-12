import { useEffect, useRef, useState } from 'react'
import type { BridgeDocument, CoreApi } from './types'
import type { ReactUiStore } from './store'

interface DraftOptions {
  api: CoreApi
  store: ReactUiStore
  source: BridgeDocument
  persistedDraft: unknown
  draftKey: 'agentsDraft' | 'memoryCorrectionDraft'
  previewPath: string
  commitPath: string
  label: string
}

interface DraftPreview {
  content: string
  sourceHash: string | null | undefined
  generation: number
  comparison: string
  before?: { hash?: string | null }
}

export function useDraftEditor({ api, store, source, persistedDraft, draftKey, previewPath, commitPath, label }: DraftOptions) {
  const [draft, setDraft] = useState(String(persistedDraft ?? source.content ?? ''))
  const [preview, setPreview] = useState<DraftPreview | null>(null)
  const [message, setMessage] = useState('')
  const current = useRef({
    generation: 0, dirty: false, disposed: false, busy: false,
    draft, sourceHash: source.hash, persistedDraft,
  })
  Object.assign(current.current, { draft, sourceHash: source.hash, persistedDraft })
  useEffect(() => {
    current.current.disposed = false
    return () => { current.current.disposed = true; current.current.generation += 1 }
  }, [])
  useEffect(() => {
    current.current.generation += 1
    setPreview(null)
    // Only mark the editor clean after the rendered source has caught up.
    // Deleting a saved draft can re-render before the Bridge refresh returns.
    if (persistedDraft == null && current.current.draft === source.content) current.current.dirty = false
    if (!current.current.dirty) setDraft(String(persistedDraft ?? source.content ?? ''))
  }, [source.hash, source.content, persistedDraft])
  const edit = (value: string) => {
    current.current.dirty = true
    current.current.generation += 1
    current.current.draft = value
    setDraft(value)
    setPreview(null)
  }
  const runPreview = async () => {
    const state = current.current
    const generation = ++state.generation
    const content = state.draft
    const sourceHash = state.sourceHash
    setPreview(null)
    try { api.validateDraftData(content) } catch { setMessage('草案包含敏感内容或超出限制'); return }
    const result = await api.bridgeCall(previewPath, {
      content, ...(typeof sourceHash === 'string' ? { expectedHash: sourceHash } : {}),
    })
    if (state.disposed || generation !== state.generation || content !== state.draft || sourceHash !== state.sourceHash) return
    setPreview(result.status === 'ok' ? {
      ...result, content, sourceHash, generation,
      comparison: `--- 当前磁盘内容\n${source.content || ''}\n+++ 确认后写入内容\n${content}`,
    } : null)
    setMessage(result.status === 'ok' ? '请核对以下原文和拟写入内容' : result.message || '预览失败')
  }
  const commit = async () => {
    const state = current.current
    if (state.disposed || state.busy || !preview || preview.content !== state.draft
      || preview.generation !== state.generation || preview.sourceHash !== state.sourceHash) return
    const content = preview.content
    const previousDraft = state.persistedDraft
    const expectedHash = preview.before?.hash
    state.busy = true
    try {
      const result = await api.bridgeCall(commitPath, {
        content, ...(typeof expectedHash === 'string' ? { expectedHash } : {}),
      })
      if (state.disposed) return
      setPreview(null)
      if (result.status !== 'ok') { setMessage(result.status === 'conflict' ? '源文件已变化，请重新预览' : result.message || '写入失败'); return }
      let cleared = true
      if (state.draft === content) {
        state.dirty = true
        if (state.persistedDraft === previousDraft) {
          try { api.updateUiPreferences({ [draftKey]: undefined }) } catch { cleared = false }
        }
      }
      await api.refreshBridge()
      if (state.disposed) return
      store.showToast(`${label}已写入；备份：${result.backup || '新文件'}`, 'success')
      setMessage(cleared ? '写入完成；提交期间的新编辑会保留' : '文件已写入，但本地草案清理失败')
    } finally { state.busy = false }
  }
  return { draft, preview, message, runPreview, commit, edit }
}
