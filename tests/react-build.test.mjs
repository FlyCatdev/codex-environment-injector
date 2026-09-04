import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('React UI is one self-contained classic userscript fragment', () => {
  const bundlePath = path.join(root, 'build', 'react-ui.js')
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  const size = fs.statSync(bundlePath).size
  assert.ok(size > 100_000, `React should be bundled, got ${size} bytes`)
  assert.ok(size < 1_500_000, `React bundle unexpectedly large: ${size} bytes`)
  assert.match(bundle, /Environment Injector React 19 UI/)
  assert.match(bundle, /codexpp-environment-react-host/)
  assert.match(bundle, /attachUiAdapter/)
  assert.match(bundle, /React Studio/)
  assert.match(bundle, /当前对话/)
  assert.match(bundle, /下个对话/)
  assert.match(bundle, /环境管理/)
  assert.match(bundle, /replaceEnvironmentStore/)
  assert.match(bundle, /createRoot/)
  assert.doesNotMatch(bundle, /^\s*import\s/m)
  assert.doesNotMatch(bundle, /https?:\/\/[^"']+\.(?:js|css)/)
})

test('headless injector remains independent from React imports', () => {
  const core = fs.readFileSync(path.join(root, 'codexpp', 'environment-injector.template.js'), 'utf8')
  assert.doesNotMatch(core, /from ['"]react/)
  assert.match(core, /function attachUiAdapter\(/)
  assert.match(core, /function patchPrewarmThreadStart\(/)
  assert.match(core, /function patchDirectRpcTarget\(/)
  assert.match(core, /function patchDispatcher\(/)
})

test('React dependency major versions are pinned to React 19', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.match(pkg.dependencies.react, /19/)
  assert.match(pkg.dependencies['react-dom'], /19/)
})
