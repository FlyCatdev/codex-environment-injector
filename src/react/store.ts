import type { CoreApi, PanelMode, ToastKind, UiAdapter, UiSnapshot } from './types'

export interface ReactUiState {
  core: UiSnapshot
  open: boolean
  studioOpen: boolean
  mode: PanelMode
  title: string
  toast: { message: string; kind: ToastKind; nonce: number } | null
}

export class ReactUiStore implements UiAdapter {
  private state: ReactUiState
  private listeners = new Set<() => void>()
  private chooser: { promise: Promise<string | null>; resolve(value: string | null): void } | null = null
  private toastTimer = 0
  private destroyed = false
  private onDestroy: (() => void) | null = null

  constructor(private readonly api: CoreApi, initial: UiSnapshot) {
    this.state = {
      core: initial,
      open: false,
      studioOpen: false,
      mode: 'select',
      title: '选择环境',
      toast: null,
    }
  }

  setDestroyCallback(callback: () => void) {
    this.onDestroy = callback
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  private emit(next: Partial<ReactUiState>) {
    if (this.destroyed) return
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }

  status() {
    return { open: this.state.open, mode: this.state.mode }
  }

  update(snapshot: UiSnapshot) {
    const pendingProfileId = snapshot.status.pendingProfileId || ''
    if (this.chooser && pendingProfileId && pendingProfileId !== (this.state.core.status.pendingProfileId || '')) {
      const chooser = this.chooser
      this.chooser = null
      chooser.resolve(pendingProfileId)
      this.emit({ core: snapshot, open: false })
      return
    }
    this.emit({ core: snapshot })
  }

  chooseProfile(title: string, snapshot: UiSnapshot): Promise<string | null> {
    if (this.chooser) {
      this.emit({ core: snapshot, open: true, mode: 'select', title })
      return this.chooser.promise
    }
    let resolve!: (value: string | null) => void
    const promise = new Promise<string | null>((done) => { resolve = done })
    this.chooser = { promise, resolve }
    this.emit({ core: snapshot, open: true, mode: 'select', title })
    return promise
  }

  open(mode: PanelMode, snapshot: UiSnapshot) {
    this.emit({ core: snapshot, open: true, mode, title: mode === 'select' ? '选择环境' : '环境注入器' })
  }

  openMode(mode: PanelMode) {
    this.emit({ open: true, mode })
  }

  close() {
    const chooser = this.chooser
    this.chooser = null
    chooser?.resolve(null)
    this.emit({ open: false })
  }

  selectProfile(profileId: string) {
    const chooser = this.chooser
    this.chooser = null
    if (chooser) {
      chooser.resolve(profileId)
      this.emit({ open: false })
      return
    }
    this.api.setNext(profileId)
    this.showToast(`下个新对话：${this.profileName(profileId)}`)
    this.emit({ open: false })
  }

  openFromPill() {
    void this.api.open().then((profileId) => {
      if (!profileId) return
      this.api.setNext(profileId)
      this.showToast(`下个新对话：${this.profileName(profileId)}`)
    })
  }

  setPromptOnNewThread(enabled: boolean) {
    this.api.setPromptOnNewThread(enabled)
  }

  setExpanded(expanded: boolean) {
    this.api.updateUiPreferences({ panelExpanded: expanded })
  }

  openStudio() {
    this.emit({ open: false, studioOpen: true })
  }

  closeStudio() {
    this.emit({ studioOpen: false })
  }

  showToast(message: string, kind: ToastKind = 'info') {
    window.clearTimeout(this.toastTimer)
    this.emit({ toast: { message, kind, nonce: Date.now() } })
    this.toastTimer = window.setTimeout(() => this.emit({ toast: null }), 2800)
  }

  contains(node: Node) {
    const root = node.getRootNode()
    return root instanceof ShadowRoot && (root.host as HTMLElement).id === 'codexpp-environment-react-host'
  }

  profileName(profileId: string) {
    return this.state.core.profiles.find((profile) => profile.id === profileId)?.name || profileId || 'Base'
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    window.clearTimeout(this.toastTimer)
    const chooser = this.chooser
    this.chooser = null
    chooser?.resolve(null)
    this.listeners.clear()
    this.onDestroy?.()
    this.onDestroy = null
  }
}
