import { describe, expect, it } from 'vitest'
import { installHostServices } from '../../plugin-sdk/src/services'
import { createInstalledPluginRuntime } from '../../plugin-sdk/src/plugin-runtime/installed'
import { NativeBridge } from '../src/bridge'
import { createNativeServices } from '../src/services'

describe('SDK runtime with native IPC transport', () => {
  it('scopes contributions, events and storage and disposes them on unload', async () => {
    localStorage.clear(); const messages: any[] = []
    const bridge = new NativeBridge({ postMessage: s => messages.push(JSON.parse(s)) }); bridge.setOwner({ profile: 'p', connection_id: 'a' })
    const services = createNativeServices(bridge, localStorage); const uninstall = installHostServices(services.host)
    let calls = 0
    const modules = { importMap: {}, createModuleUrl: (source: string) => source, revokeModuleUrl: () => {}, importModule: async () => ({ default: { id: 'example', register(ctx: any) { ctx.storage.set('count', 1); ctx.register({ id: 'panel', area: 'panes', render: () => 'panel' }); ctx.onEvent('change', () => calls++) } } }) }
    const runtime = createInstalledPluginRuntime(services.context, modules)
    await runtime.load('fixture', 'synthetic')
    expect(services.registry.getArea('panes')[0].id).toBe('example:panel')
    expect(messages[0]).toMatchObject({type:'plugin-storage-patch', key:'hermes.plugin.example.count', value:'1'})
    services.feedEvent({ type: 'change', profile: 'p' }); expect(calls).toBe(0)
    services.feedEvent({ type: 'change', profile: 'p', connectionId: 'a' }); expect(calls).toBe(1)
    runtime.unload('example'); services.feedEvent({ type: 'change', profile: 'p', connectionId: 'a' })
    expect(calls).toBe(1); expect(services.registry.getArea('panes')).toHaveLength(0)
    runtime.dispose(); uninstall(); bridge.close()
  })
})
