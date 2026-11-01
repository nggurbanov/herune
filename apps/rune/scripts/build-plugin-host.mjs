import path from 'node:path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const rune = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(rune, '../..')
const host = path.join(repo, 'packages/native-plugin-host')
const desktopPath = path.join(repo, 'apps/desktop')
const desktop = fs.existsSync(desktopPath) ? fs.realpathSync(desktopPath) : desktopPath
const shared = path.resolve(rune, '../shared/src')
const output = path.join(rune, 'assets/plugin-host')
const requireFromDesktop = createRequire(path.join(host, 'package.json'))
const react = path.dirname(requireFromDesktop.resolve('react/package.json'))
const reactDom = path.dirname(requireFromDesktop.resolve('react-dom/package.json'))
const modules = new Set()
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const relative = file => path.relative(repo, file).split(path.sep).join('/')
function atomic(file, bytes) {
  const content = Buffer.from(bytes)
  if (fs.existsSync(file) && fs.readFileSync(file).equals(content)) return
  fs.writeFileSync(`${file}.new`, content)
  fs.renameSync(`${file}.new`, file)
}
function deny(id) { const file=id.split('?')[0]; if(!path.isAbsolute(file) || !fs.existsSync(file)) return; const real=fs.realpathSync(file); if(real === desktop || real.startsWith(desktop+path.sep)) throw new Error(`Desktop input forbidden: ${real}`) }
const result = await build({
  logLevel: 'error', configFile: false, envDir: false, envPrefix: [], root: host,
  plugins: [tailwindcss(), { name: 'plugin-sdk-provenance', enforce:'pre', async resolveId(source, importer, options) { const result=await this.resolve(source,importer,{...options,skipSelf:true}); if(result) deny(result.id); return result }, load(id) { deny(id) }, generateBundle() { for (const id of this.getModuleIds()) { deny(id); modules.add(id) } } }],
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react, 'react-dom': reactDom,
    '@hermes/plugin-sdk': path.join(repo, 'packages/plugin-sdk/src/index.ts'),
    '@hermes/shared/ansi': path.join(shared, 'ansi.ts'), '@hermes/shared/billing': path.join(shared, 'billing-types.ts'),
    '@hermes/shared/color': path.join(shared, 'color.ts'), '@hermes/shared/i18n': path.join(shared, 'i18n.ts'),
    '@hermes/shared/translucency': path.join(shared, 'translucency.ts'), '@hermes/shared': path.join(shared, 'index.ts'),
  } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env.MODE': JSON.stringify('production'), 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' },
  build: { write: false, minify: true, assetsInlineLimit: 100000000,
    lib: { entry: path.join(host, 'src/host.tsx'), formats: ['es'], fileName: () => 'host.js' }, outDir: output },
})
const assets = {}
for (const item of (Array.isArray(result) ? result : [result]).flatMap(result => result.output)) {
  if (item.type === 'chunk') assets[item.fileName] = item.code
  else if (item.fileName.endsWith('.css')) assets['host.css'] = typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString()
  else assets[item.fileName] = 'base64:' + Buffer.from(item.source).toString('base64')
}
const inputs = new Map()
const packages = new Map()
function source(file) { if (fs.existsSync(file) && fs.statSync(file).isFile()) inputs.set(relative(file), sha(fs.readFileSync(file))) }
function packageFor(file) {
  let dir = path.dirname(file)
  for (;;) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) return [dir, JSON.parse(fs.readFileSync(manifest, 'utf8'))]
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
for (const id of modules) {
  const file = id.split('?')[0]
  if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue
  if (!file.includes(`${path.sep}node_modules${path.sep}`) && file.startsWith(repo + path.sep)) source(file)
  else {
    const found = packageFor(file)
    if (found && found[1].name) packages.set(`${found[1].name}@${found[1].version}`, found)
  }
}
// Vite embeds CSS url() assets without listing them as JavaScript modules.
for (const id of modules) {
  const file=id.split('?')[0]
  if (!path.isAbsolute(file) || !file.endsWith('.css') || !fs.existsSync(file)) continue
  for (const match of fs.readFileSync(file,'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const value=match[1].trim().split('?')[0]
    if (!value || /^(?:data:|https?:|#)/i.test(value)) continue
    const asset=path.resolve(path.dirname(file),decodeURIComponent(value)); deny(asset)
    if (fs.existsSync(asset) && asset.startsWith(repo + path.sep) && !asset.includes(`${path.sep}node_modules${path.sep}`)) source(asset)
  }
}
// Type-only imports are not present in the bundled module graph.
const typeFiles = execFileSync(path.join(repo, 'node_modules/.bin/tsc'), ['-p', path.join(host, 'tsconfig.json'), '--listFilesOnly'], { cwd: host, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
for (const file of typeFiles) { deny(file); if (path.isAbsolute(file) && file.startsWith(repo + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`)) source(file) }
for (const file of ['package-lock.json', 'package.json', 'packages/native-plugin-host/package.json', 'packages/native-plugin-host/src/fonts/OFL-JetBrainsMono.txt', 'packages/plugin-sdk/package.json', 'packages/builtin-bots/package.json', 'apps/rune/scripts/build-plugin-host.mjs', 'LICENSE']) source(path.join(repo, file))
const licenses = []
const dependencies = []
for (const [name, [dir, manifest]] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const texts = fs.readdirSync(dir).filter(file => /^(licen[sc]e|copying|notice)(\..*)?$/i.test(file) && fs.statSync(path.join(dir, file)).isFile())
  dependencies.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? null,
    license_files: texts.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(dir, file))) })) })
  licenses.push(`${name}\nManifest license: ${JSON.stringify(manifest.license ?? null)}\n` + texts.map(file => `--- ${file} ---\n${fs.readFileSync(path.join(dir, file), 'utf8')}`).join('\n'))
}
if (inputs.size < 100 || dependencies.length < 20) throw new Error('The SDK provenance graph is unexpectedly incomplete')
const data = JSON.stringify(assets)
const compressed = zlib.gzipSync(Buffer.from(data), { level: 9 })
const notice = `Herune native plugin host and extracted Hermes SDK\n${fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8')}\n\nJetBrains Mono\n${fs.readFileSync(path.join(host, 'src/fonts/OFL-JetBrainsMono.txt'), 'utf8')}\n\n${licenses.join('\n\n====================\n\n')}`.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
const manifest = {
  schema: 1, source_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  build_command: 'node apps/rune/scripts/build-plugin-host.mjs', node: process.version,
  source_inputs: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))), dependencies,
  assets: Object.fromEntries(Object.entries(assets).map(([name, value]) => [name, { bytes: Buffer.byteLength(value), sha256: sha(value) }])),
  archive: { file: 'assets.json.gz', bytes: compressed.length, sha256: sha(compressed) },
  notices: { file: 'THIRD_PARTY_LICENSES.txt', sha256: sha(notice) },
}
fs.mkdirSync(output, { recursive: true })
atomic(path.join(output, 'assets.json'), data)
atomic(path.join(output, 'assets.json.gz'), compressed)
atomic(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
atomic(path.join(output, 'THIRD_PARTY_LICENSES.txt'), notice)
console.log(`Built native plugin host: ${inputs.size} source inputs, ${dependencies.length} dependency packages, ${(compressed.length / 1024 / 1024).toFixed(1)} MiB archive`)
