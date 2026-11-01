import { spawnSync } from 'node:child_process'

// Vitest workers must also disable Node's experimental storage global so that
// jsdom supplies the browser implementation to the tests.
const result = spawnSync(process.execPath, ['../../node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --no-experimental-webstorage`.trim() },
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
