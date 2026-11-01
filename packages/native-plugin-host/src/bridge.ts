/** Adapted from apps/rune/src/plugin_host/web/bridge.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04. MIT; see LICENSE. */
export interface NativePort { postMessage(message: string): void }
export interface Owner { profile: string; connection_id: string }
export class NativeBridge {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private owner: Owner | null = null
  private generation = 0
  constructor(private readonly port: NativePort) {}
  setOwner(owner: Owner) {
    if (!owner.profile || !owner.connection_id) throw new Error('Native owner requires a profile and connection ID')
    if (this.owner && (owner.profile !== this.owner.profile || owner.connection_id !== this.owner.connection_id)) this.generation++
    this.owner = { profile: owner.profile, connection_id: owner.connection_id }
  }
  lease() {
    if (!this.owner) throw new Error('Native owner is unavailable')
    const owner = { ...this.owner }, generation = this.generation
    return { owner, assert: () => { if (generation !== this.generation) throw new Error('Native owner lease expired') } }
  }
  emit(message: unknown) { this.port.postMessage(JSON.stringify(message)) }
  ask<T>(kind: string, payload: unknown = {}, timeoutMs = 30000): Promise<T> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The native host request timed out; its outcome may be unknown')) }, Math.min(Math.max(timeoutMs, 1000), 86400000))
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      try { this.emit({ type: 'plugin-request', id, kind, payload, timeout_ms: timeoutMs }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  receive(message: { type?: string; id?: string; value?: unknown; error?: string }) {
    if (message.type !== 'plugin-response' || !message.id) return
    const request = this.pending.get(message.id)
    if (!request) return
    this.pending.delete(message.id); clearTimeout(request.timer)
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value)
  }
  close() { this.generation++; this.owner = null; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Native host closed; request outcome may be unknown')) }; this.pending.clear() }
  async rpc<T>(method: string, params: Record<string, unknown> = {}, route?: Owner, timeoutMs?: number): Promise<T> {
    const lease = this.lease(); const selected = route ?? lease.owner
    const result = await this.ask<T>('rpc', { connectionId: selected.connection_id, method, params: { profile: selected.profile, ...params } }, timeoutMs)
    lease.assert(); return result
  }
  async api<T>(path: string, options: Record<string, unknown> = {}, route?: Owner): Promise<T> {
    const lease = this.lease(); const selected = route ?? lease.owner
    const request: Record<string, unknown> = { ...options, path, connectionId: selected.connection_id, profile: selected.profile }
    const upload = request.upload as { filename: string; contentType?: string; bytes: ArrayBuffer } | undefined
    delete request.upload
    const timeout = typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined
    if (!upload) { const result = await this.ask<T>('api', request, timeout); lease.assert(); return result }
    const metadata = structuredClone(request)
    const bytes = new Uint8Array(upload.bytes).slice()
    if (bytes.length > 256 * 1024 * 1024) throw new Error('The plugin upload exceeds the 256 MiB limit')
    const transfer = crypto.randomUUID()
    try {
      await this.ask('upload-start', { transfer_id: transfer, total_bytes: bytes.length, filename: upload.filename, content_type: upload.contentType ?? 'application/octet-stream', request: metadata })
      lease.assert()
      for (let offset = 0, index = 0; offset < bytes.length; offset += 8 * 1024 * 1024, index++) {
        const chunk = bytes.subarray(offset, Math.min(offset + 8 * 1024 * 1024, bytes.length))
        const pieces: string[] = []
        for (let start = 0; start < chunk.length; start += 16384) pieces.push(String.fromCharCode(...chunk.subarray(start, start + 16384)))
        await this.ask('upload-chunk', { transfer_id: transfer, index, bytes_base64: btoa(pieces.join('')) }); lease.assert()
      }
      const result = await this.ask<T>('api', { ...metadata, upload: { transfer_id: transfer } }, timeout)
      lease.assert(); return result
    } catch (error) {
      // Abort cleans up only staged bytes; it never retries the API mutation.
      await this.ask('upload-abort', { transfer_id: transfer }).catch(() => {})
      throw error
    }
  }
}
