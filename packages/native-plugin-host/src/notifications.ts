/** Attributed native notification callbacks remain in the owning WebView. */
import type { PluginNativeNotificationInput } from '../../plugin-sdk/src/plugin-contract'
import { resolveHermesOpenPath } from './open-target'
import type { NativeBridge } from './bridge'
interface Pending { lease: ReturnType<NativeBridge['lease']>; pluginId: string; activate?: () => void; actions: Map<string, () => void> }
export function createNotifications(bridge: NativeBridge) {
  const pending = new Map<string, Pending>()
  return {
    send(pluginId: string, input: PluginNativeNotificationInput, track: (fn: () => void) => () => void) {
      const lease = bridge.lease()
      const notifyId = crypto.randomUUID()
      const callbacks: Pending = { lease, pluginId, activate: input.onActivate, actions: new Map((input.actions ?? []).filter(a => a.onAction).map(a => [a.id, a.onAction!])) }
      pending.set(notifyId, callbacks)
      const dispose = track(() => { pending.delete(notifyId) })
      const payload = { title: input.title, body: input.body, icon: input.icon, silent: input.silent, tag: pluginId, notifyId,
        activate: resolveHermesOpenPath(input.activate) ?? undefined,
        actions: input.actions?.map(action => ({ id: action.id, text: action.label, activate: resolveHermesOpenPath(action.activate) ?? undefined })) }
      void bridge.ask<boolean>('native-notify', payload).then(accepted => { if (!accepted) dispose() }, error => { dispose(); bridge.emit({ type: 'plugin-error', message: String(error) }) })
    },
    receive(message: { type: string; notifyId?: string; actionId?: string; pluginId?: string; activate?: unknown }): string | null {
      if (message.type !== 'plugin-notify-closed' && message.type !== 'plugin-notify-activate') return null
      const found = message.notifyId ? pending.get(message.notifyId) : undefined
      if (!found || found.pluginId !== message.pluginId && message.type === 'plugin-notify-activate') return null
      pending.delete(message.notifyId!)
      if (message.type === 'plugin-notify-closed') return null
      try { found.lease.assert() } catch { return null }
      if (message.actionId) found.actions.get(message.actionId)?.(); else found.activate?.()
      return resolveHermesOpenPath(message.activate as Parameters<typeof resolveHermesOpenPath>[0])
    },
    clear() { pending.clear() }
  }
}
