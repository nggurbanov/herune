/** Owner-qualified gateway pool. HermesGateway supplies canonical protocol and replay. */
import { HermesGateway } from '../../plugin-sdk/src/gateway/client'
import { canonicalOwnerProfile } from '../../plugin-sdk/src/gateway/canonical-protocol'
import type { NativeBridge, Owner } from './bridge'
interface Entry { gateway: HermesGateway; refs: number; ready: Promise<void>; closed: boolean }
export function createGatewayPool(bridge: NativeBridge, onEvent: (event: unknown) => void, onPrimaryState: (state: string) => void) {
  const entries = new Map<string, Entry>()
  let primary: {key:string; release:()=>void} | null = null
  let closed = false
  const keyOf = (owner: Owner) => JSON.stringify([owner.connection_id, owner.profile])
  const retain = async (owner: Owner) => {
    if (closed) throw new Error('Gateway pool is closed')
    const lease = bridge.lease(), key = keyOf(owner)
    let entry = entries.get(key)
    if (!entry) {
      const gateway = new HermesGateway()
      const created: Entry = {gateway,refs:0,closed:false,ready:Promise.resolve()}
      entry = created; entries.set(key, created)
      gateway.onAny(event => { try { lease.assert() } catch { return }; const profile=canonicalOwnerProfile(event) ?? event.profile ?? owner.profile; onEvent({...event,profile,connectionId:owner.connection_id}) })
      gateway.onState(state => { if (primary?.key === key) onPrimaryState(state) })
      created.ready = (async () => {
        const result = await bridge.ask<{url: string | null}>('plugin-gateway-prepare', {connectionId:owner.connection_id,profile:owner.profile},60000)
        lease.assert()
        if (!result.url) throw new Error('Native gateway socket is unavailable')
        if (closed || created.closed) throw new Error('Gateway lease was retired')
        await gateway.connect(result.url); lease.assert()
      })().catch(error => { if (entries.get(key) === created) entries.delete(key); gateway.close(); throw error })
    }
    entry.refs++
    const held = entry
    let released = false
    const release = () => { if (released) return; released = true; held.refs--; if (held.refs === 0) { held.closed=true; if (entries.get(key)===held) entries.delete(key); held.gateway.close() } }
    try { await held.ready; lease.assert(); if (released || held.closed) throw new Error('Gateway lease was retired'); return {gateway:held.gateway,release} }
    catch (error) { release(); throw error }
  }
  return {
    async connectPrimary(owner: Owner) { const key=keyOf(owner); if (primary?.key===key) return; const held=await retain(owner); primary?.release(); primary={key,release:held.release}; onPrimaryState(held.gateway.connectionState) },
    getPrimary() { return primary ? entries.get(primary.key)?.gateway ?? null : null },
    async request<T>(owner: Owner, method: string, params: Record<string, unknown>, timeoutMs?: number) { const held=await retain(owner); const lease=bridge.lease(); try { const result=await held.gateway.request<T>(method,{profile:owner.profile,...params},timeoutMs); lease.assert(); return result } finally { held.release() } },
    async retain(owner: Owner) { return (await retain(owner)).release },
    retainSocket(owner: Owner) { let release: (()=>void)|null=null, disposed=false; void retain(owner).then(held=>{if(disposed) held.release(); else release=held.release}, error=>bridge.emit({type:'plugin-error',message:String(error)})); return () => {disposed=true;release?.()} },
    close() { closed=true; primary?.release();primary=null;for (const entry of entries.values()) {entry.closed=true;entry.gateway.close()} entries.clear() }
  }
}
