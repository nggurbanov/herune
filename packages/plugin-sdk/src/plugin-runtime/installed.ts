import { getHostServices, onHostServicesDisposed } from '../services'
import { browserRuntimeModules } from './browser'
import { createPluginRuntime, type RuntimeModuleHost } from './loader'
import type { RuntimeContextServices } from './context'

/** Bind plugin contexts to the same installed host used by the SDK namespace.
 * The host supplies the scoped context doors and owns their resources. */
export function createInstalledPluginRuntime(
  services: Omit<RuntimeContextServices, 'host'>,
  modules: RuntimeModuleHost = browserRuntimeModules(),
  timeoutMs?: number
) {
  let disposed = false
  const assertLive = () => { if (disposed) throw new Error('Plugin runtime is disposed') }
  const runtime = createPluginRuntime({ ...services, host: getHostServices() }, modules, timeoutMs, assertLive)
  const dispose = () => { if (disposed) return; disposed = true; detach(); runtime.dispose() }
  const detach = onHostServicesDisposed(dispose)
  return {
    async load(...args: Parameters<typeof runtime.load>) {
      if (disposed) throw new Error('Plugin runtime is disposed')
      const loaded = await runtime.load(...args)
      if (disposed) { loaded.deactivate(); throw new Error('Plugin runtime is disposed') }
      return { ...loaded, activate() { if (disposed) throw new Error('Plugin runtime is disposed'); loaded.activate() } }
    },
    unload: runtime.unload,
    dispose
  }
}
