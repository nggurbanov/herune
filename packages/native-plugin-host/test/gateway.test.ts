import {expect,it} from 'vitest'
import {NativeBridge} from '../src/bridge'
import {installNativeSockets} from '../src/socket'
import {createGatewayPool} from '../src/gateway'
it('uses a retained actual SDK gateway and routes requests to its captured source and profile', async () => {
  const frames:any[]=[]; let bridge:NativeBridge
  const send=(message:unknown)=>window.dispatchEvent(new CustomEvent('hermes-host-message',{detail:message}))
  bridge=new NativeBridge({postMessage:s=>{const m=JSON.parse(s);frames.push(m);queueMicrotask(()=>{
    if(m.kind==='plugin-gateway-prepare') bridge.receive({type:'plugin-response',id:m.id,value:{url:'ws://hermes-native-gateway.invalid/r1'}})
    else if(m.kind==='plugin-socket-open') {bridge.receive({type:'plugin-response',id:m.id,value:{}});send({type:'plugin-socket',receipt:'r1',event:'open',data:{}})}
    else if(m.kind==='plugin-socket-send') {bridge.receive({type:'plugin-response',id:m.id,value:{}});const f=JSON.parse(m.payload.frame.text);if(f.id!==undefined)send({type:'plugin-socket',receipt:'r1',event:'message',data:{text:JSON.stringify({jsonrpc:'2.0',id:f.id,result:{ok:true}})}})}
    else bridge.receive({type:'plugin-response',id:m.id,value:{}})
  })}})
  bridge.setOwner({connection_id:'a',profile:'default'});const remove=installNativeSockets(bridge);const events:unknown[]=[]
  const pool=createGatewayPool(bridge,e=>events.push(e),()=>{})
  try {
    const owner={connection_id:'b',profile:'ops'};const release=await pool.retain(owner)
    await expect(pool.request(owner,'session.list',{profile:'ops-target'})).resolves.toEqual({ok:true})
    const prepare=frames.find(m=>m.kind==='plugin-gateway-prepare');expect(prepare.payload).toEqual({connectionId:'b',profile:'ops'})
    const rpc=frames.filter(m=>m.kind==='plugin-socket-send').map(m=>JSON.parse(m.payload.frame.text)).find(m=>m.method==='session.list'); expect(rpc.params.profile).toBe('ops-target')
    expect(frames.filter(m=>m.kind==='plugin-gateway-prepare')).toHaveLength(1);release()
  } finally {pool.close();remove();bridge.close()}
})
