import {expect,it,vi} from 'vitest'
import {NativeBridge} from '../src/bridge'
import {createNativeServices} from '../src/services'
it('only acknowledges the async workspace after native success and fences a stale owner',async()=>{
  const frames:any[]=[];const bridge=new NativeBridge({postMessage:s=>frames.push(JSON.parse(s))});const services=createNativeServices(bridge,localStorage);services.hydrate({connection_id:'a',profile:'p'})
  const target={kind:'blocked' as const,message:'Select a bot'}
  expect(services.host.setWorkspaceScope!('bots','owner',target)).toBe(false)
  const pending=services.host.setWorkspaceScopeAsync!('bots','owner',target);await vi.waitFor(()=>expect(frames.some(x=>x.kind==='workspace-scope')).toBe(true))
  expect(services.host.setWorkspaceScope!('bots','owner',target)).toBe(false)
  const frame=frames.find(x=>x.kind==='workspace-scope');expect(frame.payload.clientOwner).toEqual({connection_id:'a',profile:'p'});bridge.receive({type:'plugin-response',id:frame.id,value:true});await expect(pending).resolves.toBe(true)
  expect(services.host.setWorkspaceScope!('bots','owner',target)).toBe(true)
  const stale=services.host.setWorkspaceScopeAsync!('sessions');await vi.waitFor(()=>expect(frames.filter(x=>x.kind==='workspace-scope')).toHaveLength(2));const frame2=frames.filter(x=>x.kind==='workspace-scope').at(-1)
  services.hydrate({connection_id:'b',profile:'p'});bridge.receive({type:'plugin-response',id:frame2.id,value:true});await expect(stale).rejects.toThrow('lease expired');expect(services.host.setWorkspaceScope!('sessions')).toBe(false)
  services.pool.close();bridge.close()
})
