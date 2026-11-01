import { build } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve, isAbsolute, sep, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpath, readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, '../..')
const desktop = await realpath(resolve(repo, 'apps/desktop')).catch(error => { if (error.code === 'ENOENT') return resolve(repo, 'apps/desktop'); throw error })
const files = new Set()
async function check(id) {
  const path = id.split('?')[0]
  if (!isAbsolute(path)) return
  let real
  try { real = await realpath(path) } catch { return }
  if (real === desktop || real.startsWith(desktop + sep)) throw new Error(`Forbidden Desktop input: ${real}`)
  files.add(real)
}
await build({ configFile: false, root, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [tailwindcss(), { name: 'deny-desktop', enforce: 'pre', async resolveId(source, importer, options) { const found = await this.resolve(source, importer, {...options, skipSelf: true}); if (found) await check(found.id); return found }, async load(id) { await check(id) } }], resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query'], alias: [{find:'@hermes/plugin-sdk',replacement:resolve(repo,'packages/plugin-sdk/src/index.ts')},{find:/^@hermes\/shared\/(.*)$/, replacement:resolve(repo,'apps/shared/src/$1.ts')},{find:'@hermes/shared',replacement:resolve(repo,'apps/shared/src/index.ts')}] }, build: { lib: {entry:resolve(root,'src/host.tsx'), formats:['es'], fileName:()=>'host.js'}, outDir:resolve(root,'dist-host'), rollupOptions:{ output:{inlineDynamicImports:true} } } })
const entries = []
for (const file of [...files].sort()) { const bytes = await readFile(file); entries.push({path: relative(repo,file),sha256:createHash('sha256').update(bytes).digest('hex')}) }
await mkdir(resolve(root,'dist-host'),{recursive:true})
await writeFile(resolve(root,'dist-host/inputs.json'),JSON.stringify(entries,null,2)+'\n')
