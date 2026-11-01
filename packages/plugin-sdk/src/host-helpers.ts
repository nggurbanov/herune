import type { ModelOptionProvider } from '@hermes/shared'
import { requireCapability } from './services'
export type HapticIntent = 'cancel' | 'close' | 'crisp' | 'error' | 'open' | 'selection' | 'streamDone' | 'streamStart' | 'submit' | 'success' | 'tap' | 'warning'
export interface SiblingWsRoute { connectionId?: null | string; profile?: null | string }
export interface ProfileGroupRoute { connectionId: null | string; profile: string }
export function haptic(intent: HapticIntent = 'selection'): void { requireCapability('haptic')(intent) }
export function ackStoredSessionId(id: null | string, profileHint?: null | string): void { requireCapability('ackStoredSessionId')(id, profileHint) }
export function markSessionUnreadFinished(id: string, profileHint?: null | string): void { requireCapability('markSessionUnreadFinished')(id, profileHint) }
export function forgetSessionUnread(ids: readonly (null | string | undefined)[], profile?: null | string): void { requireCapability('forgetSessionUnread')(ids, profile) }
export function gatewayActivationEpoch(): number { return requireCapability('gatewayActivationEpoch')() }
export function useGatewayActivationEpoch(): number { return requireCapability('useGatewayActivationEpoch')() }
export async function resolveSiblingWsUrl(route: SiblingWsRoute, path: string, options: { stripGatewayCredential?: boolean } = {}): Promise<string> { return requireCapability('resolveSiblingWsUrl')(route, path, options) }
type CatalogProviderIdentity = Partial<Pick<ModelOptionProvider, 'aliases' | 'name'>> & Pick<ModelOptionProvider, 'slug'>
export function catalogProviderMatches(provider: CatalogProviderIdentity, currentProvider: string): boolean {
  if (!currentProvider) return false
  return provider.slug === currentProvider || provider.name === currentProvider || (provider.aliases?.includes(currentProvider) ?? false)
}
export function nextRunOverdueMs(job: { enabled?: boolean; next_run_at?: null | string; state?: null | string }, nowMs = Date.now()): null | number {
  const state = typeof job.state === 'string' ? job.state.trim() : ''
  const effective = state || (job.enabled === false ? 'disabled' : 'scheduled')
  if (effective === 'paused' || effective === 'completed' || effective === 'disabled' || !job.next_run_at) return null
  const at = Date.parse(job.next_run_at)
  if (Number.isNaN(at)) return null
  const overdue = nowMs - at
  return overdue > 15 * 60 * 1000 ? overdue : null
}
export async function writeClipboardText(text: string): Promise<void> { return requireCapability('writeClipboardText')(text) }
export interface ConfirmRequest { title: string; description?: string; confirmLabel?: string; busyLabel?: string; doneLabel?: string; details?: { label: string; value: string }[]; onConfirm?: () => Promise<void>; cancelLabel?: string; destructive?: boolean }
export function confirm(request: ConfirmRequest): Promise<boolean> { return requireCapability('confirm')(request) }

/** Captures the current source and profile when called. */
export function captureGatewayFileDownload(): (path: string, suggestedName: string) => Promise<void> { return requireCapability('captureGatewayFileDownload')() }
