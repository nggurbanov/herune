import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { denyDesktop } from '../build-guard.mjs'

it('rejects a resolved import into the legacy renderer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-boundary-'))
  try {
    const desktop = join(root, 'desktop')
    await mkdir(desktop)
    const forbidden = join(desktop, 'source.js')
    await writeFile(forbidden, 'export const value = 1')
    await expect(build({ stdin: { contents: `import ${JSON.stringify(forbidden)}`, resolveDir: root }, bundle: true, write: false, logLevel: 'silent', plugins: [await denyDesktop(desktop)] })).rejects.toThrow('Desktop dependency forbidden')
  } finally { await rm(root, { recursive: true, force: true }) }
})
