import { build } from 'esbuild'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const buildDir = fileURLToPath(new URL('./build/', import.meta.url))
await fs.mkdir(buildDir, { recursive: true })
await build({
  entryPoints: [fileURLToPath(new URL('./src/react/index.tsx', import.meta.url))],
  outfile: fileURLToPath(new URL('./build/react-ui.js', import.meta.url)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  charset: 'utf8',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  banner: {
    js: '/* Environment Injector React 19 UI */',
  },
})
