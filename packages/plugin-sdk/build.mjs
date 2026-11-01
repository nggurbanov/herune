import { build } from 'esbuild'
import { denyDesktop } from './build-guard.mjs'
await build({ entryPoints: ['src/index.ts', 'src/runtime.ts'], outdir: 'dist', bundle: true, format: 'esm', platform: 'browser', packages: 'external', external: ['./index.js'], plugins: [await denyDesktop()], sourcemap: true })
