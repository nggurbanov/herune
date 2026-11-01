import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
process.env.CARGO_TARGET_DIR = resolve(root, process.env.CARGO_TARGET_DIR || 'apps/rune/target')
// Rust 1.95 can produce unloadable stripped Mach-O proc-macros: rust-lang/rust#157750.
if (process.platform === 'darwin') {
  process.env.MACOSX_DEPLOYMENT_TARGET ??= '13.0'
  if (process.env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    process.env.CARGO_ENCODED_RUSTFLAGS = [process.env.CARGO_ENCODED_RUSTFLAGS, '-Cstrip=none'].filter(Boolean).join('\x1f')
  } else {
    process.env.RUSTFLAGS = [process.env.RUSTFLAGS, '-Cstrip=none'].filter(Boolean).join(' ')
  }
}
const [action, ...args] = process.argv.slice(2)
const targetIndex = args.indexOf('--target')
let target
if (targetIndex !== -1) {
  target = args[targetIndex + 1]
  if (!target || target.startsWith('--')) throw new Error('--target requires a Rust target triple')
  args.splice(targetIndex, 2)
}
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (!['dev', 'build', 'pack', 'dist'].includes(action)) throw new Error('Expected dev, build, pack, or dist')
if (action === 'build' && args.length) throw new Error('Only --target is supported for build')
run(process.execPath, ['apps/rune/scripts/build-plugin-host.mjs'])
const cargo = ['+1.95.0', action === 'dev' ? 'run' : 'build', '--locked', '--manifest-path', 'apps/rune/Cargo.toml']
if (action !== 'dev') cargo.push('--release')
if (target) cargo.push('--target', target)
if (action === 'dev' && args.length) cargo.push('--', ...args)
run('cargo', cargo)
if (action === 'pack' || action === 'dist') {
  const platform = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform]
  if (!platform) throw new Error(`Unsupported packaging host: ${process.platform}`)
  if (args.includes('--binary')) throw new Error('The binary is selected from the current build; do not pass --binary')
  const binary = resolve(process.env.CARGO_TARGET_DIR, ...(target ? [target] : []), 'release', process.platform === 'win32' ? 'herune.exe' : 'herune')
  run(process.execPath, [`apps/rune/scripts/package-${platform}.mjs`, '--binary', binary, ...args])
}
