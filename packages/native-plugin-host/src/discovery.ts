/** Native server's desktop-plugins door; adapted from Desktop runtime-loader at
 * 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT). */
import type { NativeBridge } from './bridge'
import type { createInventory } from './inventory'
interface FileEntry { name: string; path: string; isDirectory: boolean }
export function createDiscovery(bridge: NativeBridge, inventory: ReturnType<typeof createInventory>) {
  const known = new Map<string,{id:string; text:string}>()
  let pending: Promise<void> | null = null, disposed = false, timer: ReturnType<typeof setInterval> | null = null
  const query = (route: string, path: string) => `/api/desktop-plugins/${route}?${new URLSearchParams({path})}`
  const scan = async () => {
    if (disposed) throw new Error('Plugin discovery is disposed')
    if (pending) return pending
    const lease = bridge.lease()
    pending = (async () => {
      const {root} = await bridge.api<{root:string}>('/api/desktop-plugins/root'); lease.assert()
      const {entries} = await bridge.api<{entries:FileEntry[]}>(query('list',root)); lease.assert()
      const seen = new Set<string>()
      for (const folder of entries.filter(e=>e.isDirectory).sort((a,b)=>a.name.localeCompare(b.name))) {
        const contents = await bridge.api<{entries:FileEntry[]}>(query('list',folder.path)); lease.assert()
        const file=contents.entries.find(e=>e.name==='plugin.js' && !e.isDirectory)
        if (!file) continue
        seen.add(file.path)
        const source=await bridge.api<{text:string;truncated?:boolean}>(query('read',file.path)); lease.assert()
        if (typeof source.text !== 'string' || source.truncated) throw new Error(`Plugin ${folder.name} could not be read in full`)
        if (known.get(file.path)?.text === source.text) continue
        const marker=contents.entries.some(e=>e.name==='.hermes-package.json' && !e.isDirectory)
        const id=await inventory.load(source.text,folder.name,'disk',file.path,marker ? false : undefined); lease.assert()
        known.set(file.path,{id,text:source.text})
      }
      for (const [file,record] of known) if (!seen.has(file)) { inventory.remove(record.id,file); known.delete(file) }
    })().finally(()=>{pending=null})
    return pending
  }
  return { async prepare() { await bridge.api('/api/desktop-plugins/reconcile',{method:'POST'}); await scan() }, scan, watch() { if (!timer) timer=setInterval(()=>{void scan().catch(error=>bridge.emit({type:'plugin-error',message:String(error)}))},5000) }, dispose() { disposed=true;if(timer)clearInterval(timer);timer=null } }
}
