import type { HermesPlugin } from '../plugin-contract'
import { createPluginContext, type RuntimeContextServices } from './context'
import { rewriteImports } from './specifiers'

/** URL creation/import is host supplied so browser blob URLs and private test URLs use the same boundary. */
export interface RuntimeModuleHost {
  importMap: Readonly<Record<string, string>>
  createModuleUrl(source: string): string
  revokeModuleUrl(url: string): void
  importModule(url: string): Promise<{ default?: HermesPlugin }>
}
export function createPluginRuntime(services: RuntimeContextServices, modules: RuntimeModuleHost, timeoutMs = 10_000, assertLive: () => void = () => {}) {
  const loaded = new Map<string, { dispose(): void }>()
  const unload = (id: string) => { const instance = loaded.get(id); loaded.delete(id); instance?.dispose() }
  async function load(source: string, origin: string, enabled = true) {
    const rewritten = rewriteImports(source, modules.importMap)
    const url = modules.createModuleUrl(rewritten)
    let timer: ReturnType<typeof setTimeout> | undefined
    let mod: { default?: HermesPlugin }
    try {
      mod = await Promise.race([modules.importModule(url), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('plugin import timed out')), timeoutMs) })])
    } finally { clearTimeout(timer); modules.revokeModuleUrl(url) }
    assertLive()
    const plugin = mod.default
    if (!plugin?.id || typeof plugin.register !== 'function') throw new Error(`${origin} has no valid default HermesPlugin export`)
    let owner: { dispose(): void } | undefined
    const activate = () => {
      assertLive()
      unload(plugin.id)
      const instance = createPluginContext(plugin.id, services, Array.isArray(plugin.capabilities) ? plugin.capabilities.filter((v): v is string => typeof v === 'string') : [])
      loaded.set(plugin.id, instance)
      owner = instance
      try {
        const result: unknown = plugin.register(instance.context)
        if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
          void Promise.resolve(result).catch(error => { if (loaded.get(plugin.id) === instance) { unload(plugin.id); services.onDisposeError?.(error) } })
        }
      } catch (error) { unload(plugin.id); throw error }
    }
    if (enabled && (plugin.defaultEnabled ?? true)) activate()
    return { plugin, activate, deactivate: () => { if (loaded.get(plugin.id) === owner) unload(plugin.id) } }
  }
  const dispose = () => { for (const id of [...loaded.keys()]) unload(id) }
  return { load, unload, dispose }
}
