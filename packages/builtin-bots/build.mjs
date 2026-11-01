import { build } from 'vite'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const inputs = new Set()
await build({configFile: false, root, plugins: [{name: 'audit-inputs', generateBundle() { for (const id of this.getModuleIds()) inputs.add(id.split('?')[0]) }}], build: {lib: {entry: resolve(root, 'src/plugin.tsx'), formats: ['es'], fileName: () => 'index.js'}, outDir: resolve(root, 'dist'), rollupOptions: {external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime', 'nanostores']}}})
const files = [...inputs].filter(id => id.startsWith('/')).sort()
if (files.some(id => id.includes('/apps/desktop/'))) throw new Error('Desktop input in Bots bundle')
await mkdir(resolve(root, 'dist'), {recursive: true})
await writeFile(resolve(root, 'dist/inputs.json'), JSON.stringify(files, null, 2) + '\n')
