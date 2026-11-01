import { realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/** Reject even symlinked or relative access to the legacy renderer. */
export async function denyDesktop(desktopPath = resolve('../../apps/desktop')) {
  const desktop = await realpath(desktopPath).catch(error => { if (error.code === 'ENOENT') return desktopPath; throw error })
  return {
    name: 'deny-desktop',
    setup(build) {
      build.onLoad({ filter: /.*/ }, async args => {
        const path = await realpath(args.path)
        if (path === desktop || path.startsWith(desktop + sep)) throw new Error(`Desktop dependency forbidden: ${path}`)
        return null
      })
    }
  }
}
