import { expect,it } from 'vitest'
import { NativeBridge } from '../src/bridge'
import { createNativeServices } from '../src/services'
import { createStorage } from '../src/storage'
import { createInventory } from '../src/inventory'
import { createDiscovery } from '../src/discovery'
import { installHostServices } from '../../plugin-sdk/src/services'
import { createInstalledPluginRuntime } from '../../plugin-sdk/src/plugin-runtime/installed'
it('discovers a real SDK plugin through the native API and keeps a package disabled by default',async()=>{
  localStorage.clear(); const calls:any[]=[];let bridge:NativeBridge
  bridge=new NativeBridge({postMessage:s=>{const m=JSON.parse(s);calls.push(m);if(m.type!=='plugin-request')return;queueMicrotask(()=>{const path=m.payload.path as string;let value:any={};if(path==='/api/desktop-plugins/root')value={root:'/plugins'};else if(path?.includes('/list?'))value=path.includes('%2Fplugins%2Fone')?{entries:[{name:'plugin.js',path:'/plugins/one/plugin.js',isDirectory:false},{name:'.hermes-package.json',path:'/plugins/one/.hermes-package.json',isDirectory:false}]}:{entries:[{name:'one',path:'/plugins/one',isDirectory:true}]};else if(path?.includes('/read?'))value={text:'fixture source'};bridge.receive({type:'plugin-response',id:m.id,value})})}})
  bridge.setOwner({connection_id:'a',profile:'p'}); const services=createNativeServices(bridge,localStorage);const uninstall=installHostServices(services.host)
  const plugin={id:'disk',register(ctx:any){ctx.register({id:'pane',area:'panes'})}};const modules={importMap:{},createModuleUrl:(s:string)=>s,revokeModuleUrl:()=>{},importModule:async()=>({default:plugin})}
  const inv=createInventory(createInstalledPluginRuntime(services.context,modules),createStorage(bridge,localStorage),services.decisions);const discovery=createDiscovery(bridge,inv)
  try {await discovery.prepare();expect(inv.records.get().disk.status).toBe('disabled');expect(services.registry.getArea('panes')).toHaveLength(0);await inv.setEnabled('disk',true);expect(services.registry.getArea('panes')).toHaveLength(1);await discovery.scan();expect(calls.filter(m=>m.payload?.path==='/api/desktop-plugins/reconcile')).toHaveLength(1)} finally {discovery.dispose();inv.dispose();uninstall();bridge.close()}
})
