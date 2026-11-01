/** Plugin policy adapted from Desktop contrib/plugins-store.ts and runtime-loader.ts
 * at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT). */
import { atom } from 'nanostores'
import { createDecisions, DECISIONS_KEY } from './decisions'
import type { createInstalledPluginRuntime } from '../../plugin-sdk/src/plugin-runtime/installed'
import type { createStorage } from './storage'
type Runtime = ReturnType<typeof createInstalledPluginRuntime>
type StoragePort = ReturnType<typeof createStorage>
type Handle = Awaited<ReturnType<Runtime['load']>>
export interface PluginRecord { id: string; name: string; kind: 'bundled' | 'disk'; file?: string; description?: string; status: 'disabled' | 'activating' | 'loaded' | 'error'; error?: string }
export function createInventory(runtime: Runtime, storage: StoragePort, existingDecisions?: ReturnType<typeof createDecisions>) {
  const records = atom<Record<string, PluginRecord>>({})
  const handles = new Map<string, Handle>()
  const epochs = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()
  const decisions = existingDecisions ?? createDecisions(storage)
  const put = (record: PluginRecord) => records.set({ ...records.get(), [record.id]: record })
  async function load(source: string, origin: string, kind: PluginRecord['kind'], file?: string, defaultEnabled?: boolean) {
    // Import without registration so duplicate detection cannot replace an active owner.
    const handle = await runtime.load(source, origin, false)
    const plugin = handle.plugin, existing = records.get()[plugin.id]
    if (existing && existing.kind === 'bundled' && kind === 'disk') {
      const id = `${plugin.id}:disk-shadowed:${file ?? origin}`
      put({ id, name: `${plugin.name ?? plugin.id} (stale disk copy)`, description: `Shadowed by bundled ${plugin.id}`, kind, file, status: 'disabled' })
      return id
    }
    if (existing && (existing.file !== file || existing.kind !== kind)) throw new Error(`Duplicate plugin id "${plugin.id}" already owned by ${existing.file ?? existing.kind}`)
    existing && handles.get(plugin.id)?.deactivate()
    const record: PluginRecord = { id: plugin.id, name: plugin.name ?? plugin.id, kind, file, description: plugin.description, status: 'disabled' }
    handles.set(plugin.id, handle); put(record)
    if (decisions.get()[plugin.id] ?? (defaultEnabled ?? plugin.defaultEnabled ?? true)) await activate(plugin.id)
    return plugin.id
  }
  async function activate(id: string) {
    const previous = pending.get(id)
    if (previous) await previous.catch(() => {})
    const operation = activateNow(id)
    pending.set(id, operation)
    try { await operation } finally { if (pending.get(id) === operation) pending.delete(id) }
  }
  async function activateNow(id: string) {
    const handle = handles.get(id), record = records.get()[id]
    if (!handle || !record) throw new Error(`Plugin ${id} is not available`)
    const epoch = (epochs.get(id) ?? 0) + 1; epochs.set(id, epoch)
    const plugin = handle.plugin, original = plugin.register
    let registration: unknown
    plugin.register = ctx => { registration = original(ctx); return registration as void }
    put({...record, status:'activating', error:undefined})
    try {
      handle.activate()
      await Promise.resolve(registration)
      if (epochs.get(id) === epoch) put({...record, status:'loaded', error:undefined})
    } catch (error) {
      if (epochs.get(id) === epoch) { handle.deactivate(); put({...record, status:'error', error:String(error)}) }
      throw error
    } finally { plugin.register = original }
  }
  async function setEnabled(id: string, enabled: boolean) {
    const handle = handles.get(id), record = records.get()[id]
    if (!handle || !record) throw new Error(`Plugin ${id} is not available`)
    const next = {...decisions.get(), [id]: enabled}; storage.writeKey(DECISIONS_KEY, JSON.stringify(next)); decisions.set(next)
    if (enabled) await activate(id); else { epochs.set(id,(epochs.get(id) ?? 0)+1); handle.deactivate(); put({...record, status:'disabled',error:undefined}) }
  }
  function suspend() { const active: string[] = []; for (const [id, handle] of handles) { const record=records.get()[id]; if (!record || !['loaded','activating'].includes(record.status)) continue; active.push(id); epochs.set(id,(epochs.get(id) ?? 0)+1); handle.deactivate(); put({...record,status:'disabled'}) }; return active }
  async function resume(ids: string[]) { for (const id of ids) if (handles.has(id) && decisions.get()[id] !== false) await activate(id) }
  function remove(id: string, file: string) {
    const record = records.get()[id]
    if (!record || record.file !== file) return
    epochs.set(id,(epochs.get(id) ?? 0)+1); handles.get(id)?.deactivate(); handles.delete(id)
    const next = {...records.get()}; delete next[id]; records.set(next)
  }
  function dispose() { for (const id of handles.keys()) epochs.set(id,(epochs.get(id) ?? 0)+1); runtime.dispose(); handles.clear(); records.set({}) }
  return { records, decisions, load, setEnabled, suspend, resume, remove, dispose }
}
