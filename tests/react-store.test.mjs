import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const compiled = path.join(root, 'build', 'react-store-test.mjs')
await build({
  entryPoints: [path.join(root, 'src', 'react', 'store.ts')],
  outfile: compiled,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
})
const { ReactUiStore } = await import(`${pathToFileURL(compiled).href}?v=${Date.now()}`)

const snapshot = (pendingProfileId = '') => ({
  status: { name: '环境注入器', version: '0.3.0', profiles: [], pendingProfileId, promptOnNewThread: true },
  profiles: [{ id: 'base', name: 'Base', config: {} }, { id: 'work', name: 'work', config: {} }],
  currentProfile: { id: 'base', name: 'Base', config: {} },
  environmentStore: { schemaVersion: 2, revision: 1, profiles: {}, selection: { pendingProfileId }, bindingsByThread: {}, proofByThread: {}, migration: {}, ui: {} },
  environmentSnapshot: {},
  bridgeAgents: null,
  bridgeMemory: null,
})

const fakeApi = {
  setNext() {},
  setPromptOnNewThread() {},
  updateUiPreferences() {},
  open: async () => null,
}

test('reused chooser promise always returns to Select mode', async () => {
  const store = new ReactUiStore(fakeApi, snapshot())
  const first = store.chooseProfile('First', snapshot())
  store.openMode('agents')
  const second = store.chooseProfile('Again', snapshot())
  assert.equal(first, second)
  assert.equal(store.getSnapshot().mode, 'select')
  assert.equal(store.getSnapshot().open, true)
  store.selectProfile('work')
  assert.equal(await first, 'work')
  assert.equal(store.getSnapshot().open, false)
})

test('external pending selection resolves an open compatibility chooser', async () => {
  const store = new ReactUiStore(fakeApi, snapshot())
  const pending = store.chooseProfile('Choose', snapshot())
  store.update(snapshot('work'))
  assert.equal(await pending, 'work')
  assert.equal(store.getSnapshot().open, false)
})

test.after(async () => {
  await fs.rm(compiled, { force: true })
})
