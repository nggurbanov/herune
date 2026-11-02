import {expect,it,vi} from 'vitest'
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

it('reconnects a retained owner with a fresh receipt without replaying an interrupted request', async () => {
  const frames: any[] = []; let bridge: NativeBridge; let receipt = 0
  const send = (message: unknown) => window.dispatchEvent(new CustomEvent('hermes-host-message', {detail: message}))
  bridge = new NativeBridge({postMessage: raw => { const m = JSON.parse(raw); frames.push(m); queueMicrotask(() => {
    if (m.kind === 'plugin-gateway-prepare') bridge.receive({type:'plugin-response',id:m.id,value:{url:`ws://hermes-native-gateway.invalid/r${++receipt}`}})
    else if (m.kind === 'plugin-socket-open') { bridge.receive({type:'plugin-response',id:m.id,value:{}}); send({type:'plugin-socket',receipt:m.payload.receipt,event:'open',data:{}}) }
    else if (m.kind === 'plugin-socket-send') { bridge.receive({type:'plugin-response',id:m.id,value:{}}); const f = JSON.parse(m.payload.frame.text); if (f.method === 'session.list') send({type:'plugin-socket',receipt:m.payload.receipt,event:'message',data:{text:JSON.stringify({jsonrpc:'2.0',id:f.id,result:{ok:true}})}}) }
    else bridge.receive({type:'plugin-response',id:m.id,value:{}})
  }) }})
  bridge.setOwner({connection_id:'a',profile:'default'}); const remove = installNativeSockets(bridge)
  const events: any[] = []; const pool = createGatewayPool(bridge, event => events.push(event), () => {})
  try {
    const owner = {connection_id:'b',profile:'ops'}; const release = await pool.retain(owner)
    const pending = pool.request(owner,'settings.write',{value:'once'}); const failure = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(frames.some(m => m.kind === 'plugin-socket-send' && JSON.parse(m.payload.frame.text).method === 'settings.write')).toBe(true))
    send({type:'plugin-socket',receipt:'r1',event:'close',data:{code:1006}})
    await failure
    await vi.waitFor(() => expect(receipt).toBe(2), {timeout:3500})
    await vi.waitFor(async () => expect(await pool.request(owner,'session.list',{})).toEqual({ok:true}))
    send({type:'plugin-socket',receipt:'r2',event:'message',data:{text:JSON.stringify({jsonrpc:'2.0',method:'event',params:{type:'status.update',payload:{ok:true}}})}})
    expect(events.at(-1)).toMatchObject({type:'status.update',profile:'ops',connectionId:'b'})
    expect(frames.filter(m => m.kind === 'plugin-gateway-prepare').map(m => m.payload)).toEqual([{connectionId:'b',profile:'ops'},{connectionId:'b',profile:'ops'}])
    expect(frames.filter(m => m.kind === 'plugin-socket-send' && JSON.parse(m.payload.frame.text).method === 'settings.write')).toHaveLength(1)
    release()
    send({type:'plugin-socket',receipt:'r2',event:'close',data:{code:1006}})
    await new Promise(resolve => setTimeout(resolve,1200)); expect(receipt).toBe(2)
  } finally { pool.close(); remove(); bridge.close() }
}, 8000)

it('opens the primary gateway after it was unavailable at plugin startup', async () => {
  const frames: any[] = []; const states: string[] = []; let bridge: NativeBridge; let attempts = 0
  const send = (message: unknown) => window.dispatchEvent(new CustomEvent('hermes-host-message', {detail: message}))
  bridge = new NativeBridge({postMessage: raw => { const m = JSON.parse(raw); frames.push(m); queueMicrotask(() => {
    if (m.kind === 'plugin-gateway-prepare') {
      if (++attempts === 1) bridge.receive({type:'plugin-response',id:m.id,error:'gateway unavailable'})
      else bridge.receive({type:'plugin-response',id:m.id,value:{url:'ws://hermes-native-gateway.invalid/r2'}})
    } else if (m.kind === 'plugin-socket-open') {
      bridge.receive({type:'plugin-response',id:m.id,value:{}}); send({type:'plugin-socket',receipt:'r2',event:'open',data:{}})
    } else if (m.kind === 'plugin-socket-send') {
      bridge.receive({type:'plugin-response',id:m.id,value:{}}); const f = JSON.parse(m.payload.frame.text)
      if (f.id !== undefined) send({type:'plugin-socket',receipt:'r2',event:'message',data:{text:JSON.stringify({jsonrpc:'2.0',id:f.id,result:{ok:true}})}})
    } else bridge.receive({type:'plugin-response',id:m.id,value:{}})
  }) }})
  bridge.setOwner({connection_id:'a',profile:'default'}); const remove = installNativeSockets(bridge)
  const pool = createGatewayPool(bridge, () => {}, state => states.push(state))
  try {
    let connected = false; let failure: unknown
    const owner = {connection_id:'a',profile:'default'}
    const opening = pool.connectPrimary(owner).then(() => { connected = true }, error => { failure = error })
    owner.connection_id = 'mutated'; owner.profile = 'other'
    await vi.waitFor(() => expect(connected).toBe(true), {timeout:3500})
    await opening
    expect(failure).toBeUndefined(); expect(attempts).toBe(2)
    expect(states).toContain('error'); expect(states.at(-1)).toBe('open')
    await expect(pool.request({connection_id:'a',profile:'default'},'session.list',{})).resolves.toEqual({ok:true})
    expect(frames.filter(m => m.kind === 'plugin-gateway-prepare').map(m => m.payload)).toEqual([{connectionId:'a',profile:'default'},{connectionId:'a',profile:'default'}])
  } finally { pool.close(); remove(); bridge.close() }
}, 5000)

it('does not revive a failed startup after its owner or pool is retired', async () => {
  let bridge: NativeBridge; let attempts = 0
  bridge = new NativeBridge({postMessage: raw => { const m = JSON.parse(raw); if (m.kind === 'plugin-gateway-prepare') { attempts++; queueMicrotask(() => bridge.receive({type:'plugin-response',id:m.id,error:'offline'})) } }})
  bridge.setOwner({connection_id:'a',profile:'default'})
  const states: string[] = []; const pool = createGatewayPool(bridge, () => {}, state => states.push(state))
  try {
    const opening = pool.connectPrimary({connection_id:'a',profile:'default'})
    const retired = expect(opening).rejects.toThrow('lease expired')
    await vi.waitFor(() => expect(states).toContain('error'))
    bridge.setOwner({connection_id:'b',profile:'default'})
    await retired; expect(attempts).toBe(1)
    const second = createGatewayPool(bridge, () => {}, state => states.push(state))
    const retrying = second.connectPrimary({connection_id:'b',profile:'default'})
    const closed = expect(retrying).rejects.toThrow('pool is closed')
    await vi.waitFor(() => expect(attempts).toBe(2))
    second.close(); await closed
    await new Promise(resolve => setTimeout(resolve,1200)); expect(attempts).toBe(2)
  } finally { pool.close(); bridge.close() }
}, 5000)

it('retries a failed redial and stops when its owner changes', async () => {
  let bridge: NativeBridge; let receipt = 0; let failRedial = true
  const send = (message: unknown) => window.dispatchEvent(new CustomEvent('hermes-host-message', {detail: message}))
  bridge = new NativeBridge({postMessage: raw => { const m = JSON.parse(raw); queueMicrotask(() => {
    if (m.kind === 'plugin-gateway-prepare') bridge.receive({type:'plugin-response',id:m.id,value:{url:`ws://hermes-native-gateway.invalid/r${++receipt}`}})
    else if (m.kind === 'plugin-socket-open' && m.payload.receipt === 'r2' && failRedial) { failRedial = false; bridge.receive({type:'plugin-response',id:m.id,error:'offline'}) }
    else if (m.kind === 'plugin-socket-open') { bridge.receive({type:'plugin-response',id:m.id,value:{}}); send({type:'plugin-socket',receipt:m.payload.receipt,event:'open',data:{}}) }
    else bridge.receive({type:'plugin-response',id:m.id,value:{}})
  }) }})
  bridge.setOwner({connection_id:'a',profile:'default'}); const remove = installNativeSockets(bridge)
  const pool = createGatewayPool(bridge, () => {}, () => {})
  try {
    const release = await pool.retain({connection_id:'b',profile:'ops'})
    send({type:'plugin-socket',receipt:'r1',event:'close',data:{code:1006}})
    await vi.waitFor(() => expect(receipt).toBe(3), {timeout:5000})
    send({type:'plugin-socket',receipt:'r3',event:'close',data:{code:1006}})
    bridge.setOwner({connection_id:'other',profile:'default'})
    await new Promise(resolve => setTimeout(resolve,1200)); expect(receipt).toBe(3)
    release()
  } finally { pool.close(); remove(); bridge.close() }
}, 8000)
