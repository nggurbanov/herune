/** Native plugin namespace stream, adapted from Desktop api/plugins.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT). */
import type { NativeBridge } from './bridge'
export function pluginSocket(bridge: NativeBridge, pluginId: string, path: string, onMessage: (value: unknown) => void) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('\\') || path.includes('#')) throw new Error('Invalid plugin socket path')
  const lease = bridge.lease()
  let socket: WebSocket | null = null, stopped = false, attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const retry = () => { if (!stopped) { const delay = Math.random() * Math.min(30000, 500 * 2 ** Math.min(attempt++, 6)); timer = setTimeout(connect, delay) } }
  const connect = async () => {
    try {
      lease.assert()
      const result = await bridge.ask<{url: string | null}>('plugin-socket-prepare', { pluginId, path, profile: lease.owner.profile, connectionId: lease.owner.connection_id })
      lease.assert()
      if (stopped || !result.url) return
      const current = new WebSocket(result.url); socket = current
      current.onmessage = event => { if (stopped) return; try { lease.assert(); const value = JSON.parse(String(event.data)); attempt = 0; onMessage(value) } catch (error) { if (!(error instanceof SyntaxError)) { stopped = true; current.close(); bridge.emit({ type: 'plugin-error', message: String(error) }) } } }
      current.onclose = () => { if (socket === current) { socket = null; try { lease.assert(); retry() } catch { stopped = true } } }
      current.onerror = () => { /* close owns reconnection */ }
    } catch (error) { try { lease.assert(); bridge.emit({type: 'plugin-error', message: String(error)}); retry() } catch { stopped = true } }
  }
  void connect()
  return () => { stopped = true; clearTimeout(timer); socket?.close(); socket = null }
}
