import { describe, expect, it, vi } from 'vitest'
import { NativeBridge } from '../src/bridge'
import { createStorage, preparedSubmissions } from '../src/storage'
import { createRegistry } from '../src/registry'
describe('native transport boundaries', () => {
  it('binds requests to the originating lease and does not replay an uncertain mutation', async () => {
    const messages: any[] = []; const bridge = new NativeBridge({ postMessage: s => messages.push(JSON.parse(s)) })
    bridge.setOwner({ connection_id: 'a', profile: 'p', extra: 'not part of the lease' } as any)
    expect(bridge.lease().owner).toEqual({connection_id:'a',profile:'p'})
    const result = bridge.rpc('chat.send', { text: 'hello' })
    expect(messages[0].payload).toEqual({ connectionId: 'a', method: 'chat.send', params: { profile: 'p', text: 'hello' } })
    bridge.setOwner({ connection_id: 'b', profile: 'p' })
    bridge.receive({ type: 'plugin-response', id: messages[0].id, value: {} })
    await expect(result).rejects.toThrow('lease expired'); expect(messages).toHaveLength(1)
  })
  it('delegates journal CAS to native and reports unavailability', async () => {
    const messages: any[] = []; const bridge = new NativeBridge({ postMessage: s => messages.push(JSON.parse(s)) })
    const result = preparedSubmissions(bridge).compareAndSet('turn', null, 'prepared')
    bridge.receive({ type: 'plugin-response', id: messages[0].id, error: 'This native host operation is unavailable' })
    await expect(result).rejects.toThrow('unavailable'); expect(messages[0].kind).toBe('prepared-submissions-compare-and-set')
  })
  it('persists only the edited plugin key', () => {
    localStorage.clear(); localStorage.setItem('unrelated', 'secret')
    const send = vi.fn(); const bridge = new NativeBridge({ postMessage: send }); const storage = createStorage(bridge, localStorage)
    storage.writeKey('hermes.plugin.example.a', '1')
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: 'plugin-storage-patch', key: 'hermes.plugin.example.a', value: '1' })
    storage.writeKey('hermes.plugin.example.a', null)
    expect(JSON.parse(send.mock.calls[1][0])).toEqual({ type: 'plugin-storage-patch', key: 'hermes.plugin.example.a', value: null })
    expect(() => storage.writeKey('unrelated', '2')).toThrow()
  })
  it('persists only the changed plugin key so another window cannot be overwritten', () => {
    localStorage.clear()
    localStorage.setItem('hermes.plugin.other.setting', 'old')
    const frames: any[] = []
    const bridge = new NativeBridge({postMessage: message => frames.push(JSON.parse(message))})
    createStorage(bridge, localStorage).writeKey('hermes.plugin.first.setting', 'new')
    // The other window has independently saved a newer setting since this
    // window took its snapshot.
    const durable: Record<string, string> = {'hermes.plugin.other.setting':'newer'}
    const frame = frames[0]
    if (frame.type === 'plugin-storage-patch') durable[frame.key] = frame.value
    else Object.assign(durable, frame.values)
    expect(durable).toEqual({'hermes.plugin.other.setting':'newer', 'hermes.plugin.first.setting':'new'})
  })
  it('does not let an old disposer remove a replacement', () => {
    const registry = createRegistry(); const a = registry.register({ id: 'a', area: 'panes' }); registry.register({ id: 'a', area: 'panes', title: 'new' }); a()
    expect(registry.getArea('panes')[0].title).toBe('new')
  })
})

describe('native upload staging', () => {
  it('sends the frozen bytes once through native staging and does not retry a failed API mutation', async () => {
    const messages: any[] = []
    const bridge = new NativeBridge({ postMessage: s => { const m = JSON.parse(s); messages.push(m); queueMicrotask(() => bridge.receive({ type: 'plugin-response', id: m.id, ...(m.kind === 'api' ? { error: 'outcome unknown' } : { value: {} }) })) } })
    bridge.setOwner({ connection_id: 'a', profile: 'p' })
    const bytes = new Uint8Array([1, 2, 3]); const operation = bridge.api('/api/plugins/test/upload', { method: 'POST', upload: { filename: 'file', bytes: bytes.buffer } }); bytes[0] = 9
    await expect(operation).rejects.toThrow('outcome unknown')
    expect(messages.map(m => m.kind)).toEqual(['upload-start', 'upload-chunk', 'api', 'upload-abort'])
    expect(atob(messages[1].payload.bytes_base64).charCodeAt(0)).toBe(1)
  })
})
it('preserves an explicit target profile for native validation on the selected source', async () => {
  const frames: any[]=[]; const bridge = new NativeBridge({postMessage:s=>frames.push(JSON.parse(s))}); bridge.setOwner({connection_id:'a',profile:'p'})
  const pending=bridge.rpc('session.list',{profile:'target'}, {connection_id:'b',profile:'route'})
  expect(frames[0].payload).toMatchObject({connectionId:'b',params:{profile:'target'}})
  bridge.receive({type:'plugin-response',id:frames[0].id,value:{sessions:[]}}); await pending; bridge.close()
})
