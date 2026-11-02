import { expect, it } from 'vitest'
import { NativeBridge } from '../src/bridge'
import { createNativeServices } from '../src/services'

it('routes the plugin data handle and structured errors through native IPC', async () => {
  const frames: any[] = []
  const bridge = new NativeBridge({ postMessage: message => frames.push(JSON.parse(message)) })
  const services = createNativeServices(bridge, localStorage)
  services.hydrate({ connection_id: 'a', profile: 'p' })
  const files = services.context.createDoors('example.plugin', [], () => {}).files
  const pending = files.writeText(files.dataFolder, 'note.txt', 'hello', { exclusive: true })
  const frame = frames.at(-1)
  expect(frame.kind).toBe('plugin-data-file')
  expect(frame.payload).toEqual({ pluginId: 'example.plugin', op: 'writeText', folder: 'data', path: 'note.txt', text: 'hello', exclusive: true })
  bridge.receive({ type: 'plugin-response', id: frame.id, value: { ok: false, error: 'exists', message: 'File exists' } })
  await expect(pending).resolves.toEqual({ ok: false, error: 'exists', message: 'File exists' })
  services.pool.close()
  bridge.close()
})
