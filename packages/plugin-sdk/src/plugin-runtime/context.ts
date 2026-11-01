import type { PluginContext, PluginContribution, PluginStorage } from '../plugin-contract'
import type { PluginHostServices } from '../services'

/** Host-owned capabilities whose implementations depend on the native shell. */
export interface RuntimeContextServices {
  host: PluginHostServices
  readKey(key: string): string | null
  writeKey(key: string, value: string | null): void
  createDoors(pluginId: string, capabilities: readonly string[], track: (dispose: () => void) => () => void): Pick<PluginContext, 'rest' | 'socket' | 'os' | 'pet' | 'runAction' | 'listActions' | 'preview' | 'files' | 'i18n'>
  onDisposeError?(error: unknown): void
}

export function createPluginContext(pluginId: string, services: RuntimeContextServices, capabilities: readonly string[] = []) {
  let active = true
  const owned = new Set<() => void>()
  const assertActive = () => { if (!active) throw new Error(`Plugin context ${pluginId} is disposed`) }
  const track = (dispose: () => void) => {
    let live = true
    const once = () => { if (!live) return; live = false; owned.delete(once); dispose() }
    if (!active) once(); else owned.add(once)
    return once
  }
  const scope = (c: PluginContribution) => ({ ...c, id: `${pluginId}:${c.id}`, source: `plugin:${pluginId}` })
  const register: PluginContext['register'] = c => { assertActive(); return track(services.host.registerContribution(scope(c))) }
  const storage: PluginStorage = {
    get(key, fallback) { assertActive(); const raw = services.readKey(`hermes.plugin.${pluginId}.${key}`); if (raw === null) return fallback; try { return JSON.parse(raw) } catch { return fallback } },
    set(key, value) { assertActive(); services.writeKey(`hermes.plugin.${pluginId}.${key}`, JSON.stringify(value)) },
    remove(key) { assertActive(); services.writeKey(`hermes.plugin.${pluginId}.${key}`, null) }
  }
  const doors = services.createDoors(pluginId, capabilities, track)
  // The host creates attributed doors; a retired context must not invoke them.
  const guarded = <T extends object>(door: T): T => new Proxy(door, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      return (...args: never[]) => { assertActive(); return Reflect.apply(value, target, args) }
    }
  })
  const context: PluginContext = {
    ...doors,
    source: `plugin:${pluginId}`,
    os: guarded(doors.os), pet: guarded(doors.pet), preview: guarded(doors.preview), files: guarded(doors.files), i18n: guarded(doors.i18n),
    runAction: id => { assertActive(); return doors.runAction(id) },
    listActions: () => { assertActive(); return doors.listActions() },
    register,
    registerMany: cs => { assertActive(); const disposers: (() => void)[] = []; try { cs.forEach(c => disposers.push(register(c))) } catch (error) { disposers.forEach(d => d()); throw error }; return track(() => disposers.forEach(d => d())) },
    registerSettingsPage: page => register({ area: 'settings.plugins', id: page.id, data: { children: page.children ?? [], icon: page.icon }, order: page.order, render: page.render, title: page.title }),
    onDispose: fn => { track(fn) },
    onEvent: (type, listener) => { assertActive(); if (!services.host.onEvent) throw new Error('Plugin host capability unavailable: onEvent'); return track(services.host.onEvent(type, event => { if (active) listener(event) })) },
    setTimeout: (fn, ms) => { assertActive(); let cancel: () => void; const id = globalThis.setTimeout(() => { cancel(); if (active) fn() }, ms); cancel = track(() => globalThis.clearTimeout(id)); return cancel },
    setInterval: (fn, ms) => { assertActive(); const id = globalThis.setInterval(() => { if (active) fn() }, ms); return track(() => globalThis.clearInterval(id)) },
    addEventListener: (target, type, listener, options) => { assertActive(); target.addEventListener(type, listener, options); return track(() => target.removeEventListener(type, listener, options)) },
    storage,
    rest: (path, opts) => { assertActive(); return doors.rest(path, opts) },
    socket: (path, callback) => { assertActive(); return track(doors.socket(path, data => { if (active) callback(data) })) }
  }
  return { context, dispose() { if (!active) return; active = false; for (const cleanup of [...owned]) { try { cleanup() } catch (error) { services.onDisposeError?.(error) } } } }
}
