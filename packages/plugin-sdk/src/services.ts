import type { HermesGateway } from './gateway/client'
import type { ReadableAtom } from 'nanostores'
import type { ThemeContextValue } from './themes/host'
import type { DesktopSettings, SessionActions, ComposerActions, SpellcheckActions, SkillInfo, ToolsetInfo, ProfilesResponse, LogsResponse, StatusResponse } from './compat-host'
import type { WorkspaceMode } from './contribution'
import type { ComponentType, ComponentProps, ReactNode } from 'react'
import type { SessionStatusDotProps } from './ui/session-status-dot'
import type { GatewayEvent } from '@hermes/shared/gateway-events'
import type { I18nContextValue, PluginTranslate, AppLocaleRegistration, LanguageOption } from './i18n/ports'
import type { PluginHostState, PluginOpenSessionOptions, PluginNewChatOptions, NotificationInput, NotificationAction, DesktopAgentRoster, DesktopRegistryConnection, WorkspaceOpenOptions, WorkspaceNewSessionTarget, PaginatedSessions } from './host-types'
import type { PluginProfileRoute } from './profile-request'
import type { HapticIntent, SiblingWsRoute, ConfirmRequest } from './host-helpers'
import type { Contribution } from './contribution'
import type { ProfileRequestHost, PluginProfileRequestOptions } from './profile-request'

export type ProfileScope = undefined | null | string | { connectionId?: null | string; profile?: null | string }
export interface McpOAuthFlow { flow_id: string; server_name: string; status: 'starting' | 'authorization_required' | 'approved' | 'error'; authorization_url: string | null; error: string | null; tools?: { name: string; description: string }[] }
export interface McpOAuthOptions { serverName: string; profile?: ProfileScope; cancelled?: () => boolean; sleep?: (milliseconds: number) => Promise<void>; maxPollFailures?: number; timeoutMs?: number; catalogPreset?: string }
export interface MessageTextContentProps { decorateText?: (children: ReactNode) => ReactNode; media?: boolean; text: string }
export interface CapabilitiesViewProps extends ComponentProps<'section'> { embedded?: boolean; fixedProfile?: string; fixedConnection?: string }
export interface ConnectorsTabProps { gateway: HermesGateway | null; profile: ProfileScope }
export interface ToolsetConfigPanelProps { toolset: string; onConfiguredChange?: () => void; profile?: ProfileScope }
export interface WindowRelay { send(payload: unknown): void; onMessage(listener: (payload: unknown) => void): () => void }
export interface PreparedSubmissions { read(): Promise<string>; compareAndSet(key: string, expected: string | null, entry: string | null): Promise<{ applied: boolean; current: string | null }> }

/** Capabilities provided by the embedding application, never ambient desktop globals. */
export interface PluginHostServices {
  logs?(params: { component?: string; file?: string; level?: string; lines?: number; search?: string }): Promise<LogsResponse>
  restartGateway?(): Promise<boolean>
  status?(): Promise<StatusResponse>
  skills?: { list(profile?: ProfileScope): Promise<SkillInfo[]>; setEnabled(name: string, enabled: boolean, profile?: ProfileScope): Promise<{ ok: boolean; name: string; enabled: boolean }> }
  toolsets?: { list(profile?: ProfileScope): Promise<ToolsetInfo[]>; setEnabled(name: string, enabled: boolean, profile?: ProfileScope): Promise<{ ok: boolean; name: string; enabled: boolean }> }
  profiles?: { list(scope?: ProfileScope): Promise<ProfilesResponse> }
  i18n?: { registerAppLocale(id: string, registration: AppLocaleRegistration): () => void; languageOptions(): LanguageOption[] }
  captureGatewayFileDownload?(): (path: string, suggestedName: string) => Promise<void>
  useTheme?(): ThemeContextValue
  requestTheme?(name: string): boolean
  settings?: DesktopSettings
  sessions?: SessionActions
  composer?: ComposerActions
  spellcheck?: SpellcheckActions
  KanbanCardBadges?: ComponentType<{ card: { assignee?: null | string; id: string; status: string; tenant?: null | string }; tenants: readonly string[] }>
  WorkspacePageHeaderControl?: ComponentType<{ children: ReactNode; id: string }>
  MessageTextContent?: ComponentType<MessageTextContentProps>
  CapabilitiesView?: ComponentType<CapabilitiesViewProps> & { supportsFixedConnection: true }
  ConnectorsTab?: ComponentType<ConnectorsTabProps>
  ToolsetConfigPanel?: ComponentType<ToolsetConfigPanelProps>
  getGateway?(): HermesGateway | null
  guestFrameShellUrl?(): string | null
  completeMcpOAuth?(options: McpOAuthOptions): Promise<McpOAuthFlow>
  pluginDecisions?: ReadableAtom<Record<string, boolean>>
  onConnectionsChanged?(listener: (payload: { reason: string; connectionId: string }) => void): () => void
  windowRelay?: WindowRelay
  preparedSubmissions?: PreparedSubmissions
  registerContribution(contribution: Contribution): () => void
  profileRequests?: ProfileRequestHost
  request?<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T>
  confirm?(request: ConfirmRequest): Promise<boolean>
  writeClipboardText?(text: string): Promise<void>
  haptic?(intent: HapticIntent): void
  ackStoredSessionId?(id: null | string, profile?: null | string): void
  markSessionUnreadFinished?(id: string, profile?: null | string): void
  forgetSessionUnread?(ids: readonly (null | string | undefined)[], profile?: null | string): void
  gatewayActivationEpoch?(): number
  useGatewayActivationEpoch?(): number
  resolveSiblingWsUrl?(route: SiblingWsRoute, path: string, options: { stripGatewayCredential?: boolean }): Promise<string>
  usePaneVisible?(): boolean
  useKeybindHint?(actionId: string): string | null
  useI18n?(): I18nContextValue
  usePluginI18n?(id: string): PluginTranslate
  translateNow?(key: string, ...args: unknown[]): string
  SessionStatusDot?: ComponentType<SessionStatusDotProps>
  state?: PluginHostState
  openSession?(id: string, options?: PluginOpenSessionOptions): Promise<void>
  newChat?(profile?: null | string | PluginProfileRoute, options?: PluginNewChatOptions): void
  openWorkspace?(id: string, options: WorkspaceOpenOptions): () => void
  focusOpenWorkspaceSession?(ownerKey: string, isStaleTile?: (tile: { storedSessionId: string; workspaceTabTitle?: string }) => boolean, onlyStoredIds?: readonly string[]): null | string
  paneVisibility?(paneId: string): ReadableAtom<boolean>
  undismissPane?(paneId: string): void
  revealPane?(paneId: string): void
  setWorkspaceScope?(mode: WorkspaceMode, ownerKey?: null | string, target?: WorkspaceNewSessionTarget | null): boolean
  setWorkspaceScopeAsync?(mode: WorkspaceMode, ownerKey?: null | string, target?: WorkspaceNewSessionTarget | null): Promise<boolean>
  setWorkspaceOwnerLabel?(ownerKey: string, label: string): void
  dropLeftoverProfilePrefs?(profile: string, connectionId?: null | string): void
  traceIdentityChange?(channel: string, key: string, value: string): void
  deleteProfile?(profile: string | PluginProfileRoute): Promise<void>
  listPersistedSessions?(route: PluginProfileRoute | null, options: { profile: string; limit?: number }): Promise<PaginatedSessions>
  setPersistedSessionHidden?(route: PluginProfileRoute | null, options: { sessionId: string; profile: string; hidden: boolean }): Promise<{ ok: boolean; hidden: boolean }>
  activeConnectionId?(): null | string
  profileRoutes?(): Promise<PluginProfileRoute[]>
  agents?(): Promise<DesktopAgentRoster>
  connections?(): Promise<(DesktopRegistryConnection & { primary: boolean })[]>
  ensureAgent?(connectionId: null | string | undefined, profile: string): Promise<void>
  retainProfile?(route: PluginProfileRoute | string, options?: PluginProfileRequestOptions): Promise<() => void>
  retainProfileSocket?(route: PluginProfileRoute | string): () => void
  warmProfile?(profile: string): void
  warmAgent?(connectionId: null | string | undefined, profile: string): void
  notify?(input: NotificationInput): string
  notifyError?(error: unknown, fallback: string, options?: { action?: NotificationAction; id?: string }): string
  navigate?(path: string): void
  onEvent?(type: string, listener: (event: GatewayEvent) => void): () => void
  onWindowStateChanged?(listener: (state: { isMinimized?: boolean; isVisible?: boolean }) => void): () => void
}

let services: PluginHostServices | undefined
const disposalListeners = new Set<() => void>()

/** Install once per host; the disposer only removes its own installation. */
export function installHostServices(next: PluginHostServices): () => void {
  if (services) throw new Error('Plugin host services are already installed')
  services = next
  return () => {
    if (services !== next) return
    for (const dispose of [...disposalListeners]) dispose()
    disposalListeners.clear()
    services = undefined
  }
}

export function getHostServices(): PluginHostServices {
  if (!services) throw new Error('Plugin host services have not been installed')
  return services
}

export function requireCapability<K extends keyof PluginHostServices>(key: K): NonNullable<PluginHostServices[K]> {
  const value = getHostServices()[key]
  if (!value) throw new Error(`Plugin host capability unavailable: ${key}`)
  return value
}

/** Attach resources to the current host installation. */
export function onHostServicesDisposed(dispose: () => void): () => void {
  getHostServices()
  disposalListeners.add(dispose)
  return () => { disposalListeners.delete(dispose) }
}
