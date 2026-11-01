import { build } from 'vite'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpath, writeFile } from 'node:fs/promises'
const root = dirname(fileURLToPath(import.meta.url))
const desktop = await realpath(resolve(root, '../../apps/desktop')).catch(error => { if (error.code === 'ENOENT') return resolve(root, '../../apps/desktop'); throw error })
const files = new Set()
await build({ configFile: false, root, resolve: { alias: { '@hermes/plugin-sdk': resolve(root, '../plugin-sdk/src/index.ts') } }, plugins: [{
  name: 'deny-desktop',
  async load(id) {
    const file = id.split('?')[0]
    if (!isAbsolute(file)) return null
    const path = await realpath(file)
    if (path === desktop || path.startsWith(desktop + sep)) throw new Error(`Desktop dependency forbidden: ${path}`)
    files.add(path)
    return null
  }
}], build: { lib: { entry: resolve(root, 'src/plugin.tsx'), formats: ['es'], fileName: () => 'integrated.js' }, outDir: resolve(root, 'dist-integrated'), rollupOptions: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'] } } })
await writeFile(resolve(root, 'dist-integrated/inputs.json'), JSON.stringify([...files].sort(), null, 2) + '\n')
