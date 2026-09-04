export type PanelMode = 'select' | 'current' | 'memory' | 'agents' | 'tutorial'
export type ToastKind = 'info' | 'error' | 'success'

export interface MemoryPolicy {
  use?: 'inherit' | 'on' | 'off'
  generate?: 'inherit' | 'on' | 'off'
}

export interface EnvironmentProfile {
  id: string
  name: string
  model?: string
  modelProvider?: string
  developerInstructions?: string
  baseInstructions?: string
  approvalPolicy?: string
  sandbox?: string
  serviceTier?: string
  memoryPolicy?: MemoryPolicy
  config?: Record<string, unknown>
  source?: string
  sourceFileName?: string
}

export interface ThreadBinding {
  profileId: string
  at?: number
  source?: string
  applied?: boolean
  proofId?: string
}

export interface InjectionProof {
  proofId?: string
  profileId?: string
  status?: string
  transport?: string
  fields?: string[]
  payloadDigest?: string
  acknowledgedAt?: string
  dispatchedAt?: string
  method?: string
}

export interface InjectorStatus {
  name: string
  version: string
  generatedAt?: string
  profiles: Array<Pick<EnvironmentProfile, 'id' | 'name' | 'model' | 'modelProvider' | 'source'>>
  currentThreadId?: string
  currentProfileId?: string
  currentProfileBinding?: ThreadBinding | null
  currentProof?: InjectionProof | null
  pendingProfileId?: string
  promptOnNewThread?: boolean
  capabilities?: Record<string, unknown>
  patchedClients?: number
  lastPatchError?: string
  requestTrace?: unknown[]
}

export interface EnvironmentStoreV2 {
  schemaVersion: 2
  revision: number
  profiles: Record<string, EnvironmentProfile & { targetProfileId?: string; updatedAt?: number }>
  selection: { pendingProfileId?: string; promptOnNewThread?: boolean }
  bindingsByThread: Record<string, ThreadBinding>
  proofByThread: Record<string, InjectionProof>
  migration: { completed?: boolean; sources?: string[] }
  ui: Record<string, unknown>
}

export interface BridgeDocument {
  status?: string
  exists?: boolean
  content?: string
  hash?: string | null
  size?: number
  name?: string
}

export interface BridgeMemory {
  status?: string
  summary?: BridgeDocument
  durable?: BridgeDocument
  correction?: BridgeDocument
}

export interface UiSnapshot {
  status: InjectorStatus
  profiles: EnvironmentProfile[]
  currentProfile: EnvironmentProfile
  environmentStore: EnvironmentStoreV2
  environmentSnapshot: {
    memory?: Record<string, unknown>
    globalAgents?: BridgeDocument
    capabilities?: Record<string, unknown>
  }
  bridgeAgents?: BridgeDocument | null
  bridgeMemory?: BridgeMemory | null
}

export interface UiAdapter {
  status?(): { open: boolean; mode: PanelMode }
  chooseProfile(title: string, snapshot: UiSnapshot): Promise<string | null>
  open(mode: PanelMode, snapshot: UiSnapshot): void
  update(snapshot: UiSnapshot): void
  showToast(message: string, kind?: ToastKind): void
  contains(node: Node): boolean
  destroy(): void
}

export interface CoreApi {
  version: string
  status(): InjectorStatus
  uiSnapshot(): UiSnapshot
  attachUiAdapter(adapter: UiAdapter): () => void
  bridgeCall(path: string, payload?: Record<string, unknown>): Promise<Record<string, any>>
  refreshBridge(): Promise<UiSnapshot>
  setNext(profileId: string): InjectorStatus
  clearNext(): InjectorStatus
  setPromptOnNewThread(enabled: boolean): UiSnapshot
  replaceEnvironmentStore(store: EnvironmentStoreV2): UiSnapshot
  updateUiPreferences(patch: Record<string, unknown>): UiSnapshot
  open(): Promise<string | null>
  viewCurrent(): Promise<string | null>
  viewMemory(): Promise<string | null>
  viewAgents(): Promise<string | null>
  viewTutorial(): Promise<string | null>
}

declare global {
  interface Window {
    __codexEnvironmentInjector?: CoreApi
    __codexEnvironmentStudio?: {
      open(): void
      close(): void
      status(): unknown
      list(): unknown[]
      attachUiAdapter?(adapter: { open(): void; close(): void; status?(): { open: boolean }; destroy?(): void }): () => void
    }
    __codexEnvironmentReactUi?: { version: string; destroy(): void; status(): unknown }
  }
}
