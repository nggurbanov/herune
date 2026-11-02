import type { NativeBridge } from './bridge'
const allowed = (key: string) => key.startsWith('hermes.plugin.') || key === 'hermes.desktop.pluginDecisions.v2' || key === 'hermes.desktop.disabledPlugins.v1'
/** Existing native manager restores this snapshot before loading the document. */
export function createStorage(bridge: NativeBridge, storage: Storage) {
  return {
    readKey(key: string) { if (!allowed(key)) throw new Error('Invalid plugin storage key'); return storage.getItem(key) },
    writeKey(key: string, value: string | null) {
      if (!allowed(key)) throw new Error('Invalid plugin storage key')
      if (value === null) storage.removeItem(key); else storage.setItem(key, value)
      bridge.emit({ type: 'plugin-storage-patch', key, value })
    }
  }
}
/** CAS is a native operation; localStorage cannot safely implement it across windows. */
export function preparedSubmissions(bridge: NativeBridge) {
  return {
    read: () => bridge.ask<string>('prepared-submissions-read'),
    compareAndSet: (key: string, expected: string | null, entry: string | null) => bridge.ask<{ applied: boolean; current: string | null }>('prepared-submissions-compare-and-set', { key, expected, entry })
  }
}
