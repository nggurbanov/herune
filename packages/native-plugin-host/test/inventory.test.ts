import { expect, it, vi } from 'vitest'
import { installHostServices } from '../../plugin-sdk/src/services'
import { createInstalledPluginRuntime } from '../../plugin-sdk/src/plugin-runtime/installed'
import { NativeBridge } from '../src/bridge'
import { createNativeServices } from '../src/services'
import { createStorage } from '../src/storage'
import { createInventory } from '../src/inventory'
it('keeps a bundled owner when a disk plugin duplicates it and persists enable decisions', async () => {
  localStorage.clear(); const bridge = new NativeBridge({postMessage: () => {}}); bridge.setOwner({connection_id:'a',profile:'p'})
  const services = createNativeServices(bridge, localStorage); const uninstall=installHostServices(services.host)
  const plugin={id:'bot',defaultEnabled:true,register(ctx:any){ctx.register({id:'pane',area:'panes'})}}
  const modules={importMap:{},createModuleUrl:(s:string)=>s,revokeModuleUrl:()=>{},importModule:async()=>({default:plugin})}
  const runtime=createInstalledPluginRuntime(services.context,modules);const inventory=createInventory(runtime,createStorage(bridge,localStorage))
  await inventory.load('bundled','builtin','bundled'); await inventory.load('disk','disk','disk','/plugin.js')
  expect(services.registry.getArea('panes')).toHaveLength(1); expect(Object.values(inventory.records.get()).some(r=>r.id.includes('disk-shadowed'))).toBe(true)
  await inventory.setEnabled('bot',false); expect(services.registry.getArea('panes')).toHaveLength(0); expect(JSON.parse(localStorage.getItem('hermes.desktop.pluginDecisions.v2')!)).toEqual({bot:false})
  await inventory.setEnabled('bot',true); expect(services.registry.getArea('panes')).toHaveLength(1)
  inventory.dispose(); uninstall();bridge.close()
})
it('does not report an asynchronous registration as loaded before it succeeds', async () => {
  localStorage.clear(); const bridge=new NativeBridge({postMessage:()=>{}});bridge.setOwner({connection_id:'a',profile:'p'})
  const services=createNativeServices(bridge,localStorage); const uninstall=installHostServices(services.host)
  let reject!: (error: Error) => void; const deferred=new Promise<void>((_,r)=>{reject=r})
  const plugin={id:'async',register(ctx:any){ctx.register({id:'pane',area:'panes'});return deferred}}
  const modules={importMap:{},createModuleUrl:(s:string)=>s,revokeModuleUrl:()=>{},importModule:async()=>({default:plugin})}
  const inventory=createInventory(createInstalledPluginRuntime(services.context,modules),createStorage(bridge,localStorage))
  const load=inventory.load('source','file','disk'); await vi.waitFor(()=>expect(inventory.records.get().async?.status).toBe('activating'))
  reject(new Error('failed')); await expect(load).rejects.toThrow('failed'); expect(inventory.records.get().async.status).toBe('error'); expect(services.registry.getArea('panes')).toHaveLength(0)
  inventory.dispose();uninstall();bridge.close()
})
it('keeps decisions for different plugins changed in separate windows', async () => {
  const frames: any[] = []
  const memory = () => {
    const data = new Map<string, string>()
    return {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }} as unknown as Storage
  }
  const fakeRuntime = () => ({
    load: async (id: string) => ({plugin:{id, register() {}}, activate() {}, deactivate() {}}),
    dispose() {},
  })
  const first = createInventory(fakeRuntime() as any, createStorage(new NativeBridge({postMessage: s => frames.push(JSON.parse(s))}), memory()))
  const second = createInventory(fakeRuntime() as any, createStorage(new NativeBridge({postMessage: s => frames.push(JSON.parse(s))}), memory()))
  await first.load('a','a','disk',undefined,false)
  await second.load('b','b','disk',undefined,false)
  await first.setEnabled('a',false)
  await second.setEnabled('b',false)
  let durable: Record<string, boolean> = {}
  for (const frame of frames) {
    if (frame.type === 'plugin-decision-patch') durable[frame.pluginId] = frame.enabled
    else if (frame.key === 'hermes.desktop.pluginDecisions.v2') durable = JSON.parse(frame.value)
  }
  expect(durable).toEqual({a:false,b:false})
  first.dispose(); second.dispose()
})
