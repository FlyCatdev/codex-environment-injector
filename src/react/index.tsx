import React from 'react'
import { createRoot } from 'react-dom/client'
import { InjectorApp } from './App'
import { ReactUiStore } from './store'
import { REACT_UI_STYLES } from './styles'

const REACT_UI_VERSION = '0.3.2'
const HOST_ID = 'codexpp-environment-react-host'

window.__codexEnvironmentReactUi?.destroy?.()

const api = window.__codexEnvironmentInjector
if (api) {
  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.zIndex = '2147483200'
  host.style.pointerEvents = 'none'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = REACT_UI_STYLES
  const container = document.createElement('div')
  container.dataset.reactRoot = 'environment-injector'
  shadow.append(style, container)
  document.documentElement.append(host)

  const store = new ReactUiStore(api, api.uiSnapshot())
  const root = createRoot(container)
  let detach: (() => void) | null = null
  let detachStudio: (() => void) | null = null
  let disposed = false

  const cleanup = () => {
    if (disposed) return
    disposed = true
    const release = detach
    const releaseStudio = detachStudio
    detach = null
    detachStudio = null
    releaseStudio?.()
    release?.()
    queueMicrotask(() => {
      try { root.unmount() } catch {}
      host.remove()
    })
    if (window.__codexEnvironmentReactUi?.version === REACT_UI_VERSION) {
      delete window.__codexEnvironmentReactUi
    }
  }

  store.setDestroyCallback(cleanup)
  root.render(<InjectorApp api={api} store={store} />)
  detach = api.attachUiAdapter(store)
  detachStudio = window.__codexEnvironmentStudio?.attachUiAdapter?.({
    open: () => store.openStudio(),
    close: () => store.closeStudio(),
    status: () => ({ open: store.getSnapshot().studioOpen }),
  }) || null

  window.__codexEnvironmentReactUi = {
    version: REACT_UI_VERSION,
    destroy: () => store.destroy(),
    status: () => ({
      version: REACT_UI_VERSION,
      mounted: host.isConnected,
      open: store.getSnapshot().open,
      studioOpen: store.getSnapshot().studioOpen,
      mode: store.getSnapshot().mode,
      coreVersion: store.getSnapshot().core.status.version,
    }),
  }
}
