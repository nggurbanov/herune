import type { WorkspaceMode } from './contribution'
import type { GatewayEvent } from '@hermes/shared/gateway-events'
import { requestPluginProfile, type PluginProfileRequestOptions, type PluginProfileRoute } from './profile-request'
import type { PluginOpenSessionOptions, PluginNewChatOptions, NotificationInput, NotificationAction, WorkspaceOpenOptions, WorkspaceNewSessionTarget } from './host-types'
import { getHostServices, requireCapability } from './services'
import type { McpOAuthOptions } from './services'

/** Partial public host surface; all operations dispatch to the installed native host. */
export const host = {
  logs(params: { component?: string; file?: string; level?: string; lines?: number; search?: string }) { return requireCapability('logs')(params) },
  restartGateway() { return requireCapability('restartGateway')() },
  status() { return requireCapability('status')() },
  get skills() { return requireCapability('skills') },
  get toolsets() { return requireCapability('toolsets') },
  get profiles() { return requireCapability('profiles') },
  get i18n() { return requireCapability('i18n') },
  get settings() { return requireCapability('settings') },
  get sessions() { return requireCapability('sessions') },
  get composer() { return requireCapability('composer') },
  get spellcheck() { return requireCapability('spellcheck') },
  get pluginDecisions() { return requireCapability('pluginDecisions') },
  get windowRelay() { return requireCapability('windowRelay') },
  get preparedSubmissions() { return requireCapability('preparedSubmissions') },
  onConnectionsChanged(listener: (payload: { reason: string; connectionId: string }) => void) { return requireCapability('onConnectionsChanged')(listener) },
  getGateway() { return requireCapability('getGateway')() },
  completeMcpOAuth(options: McpOAuthOptions) { return requireCapability('completeMcpOAuth')(options) },
  get state() { return requireCapability('state') },
  async openSession(id: string, options: PluginOpenSessionOptions = {}): Promise<void> { return requireCapability('openSession')(id, options) },
  newChat(profile?: null | string | PluginProfileRoute, options: PluginNewChatOptions = {}): void { requireCapability('newChat')(profile, options) },
  openWorkspace(id: string, options: WorkspaceOpenOptions) { return requireCapability('openWorkspace')(id, options) },
  focusOpenWorkspaceSession(ownerKey: string, isStaleTile?: (tile: { storedSessionId: string; workspaceTabTitle?: string }) => boolean, onlyStoredIds?: readonly string[]) { return requireCapability('focusOpenWorkspaceSession')(ownerKey, isStaleTile, onlyStoredIds) },
  paneVisibility(paneId: string) { return requireCapability('paneVisibility')(paneId) },
  undismissPane(paneId: string) { return requireCapability('undismissPane')(paneId) },
  revealPane(paneId: string) { return requireCapability('revealPane')(paneId) },
  setWorkspaceScope(mode: WorkspaceMode, ownerKey: null | string = null, target: WorkspaceNewSessionTarget | null = null) { return requireCapability('setWorkspaceScope')(mode, ownerKey, target) },
  setWorkspaceScopeAsync(mode: WorkspaceMode, ownerKey: null | string = null, target: WorkspaceNewSessionTarget | null = null) { return requireCapability('setWorkspaceScopeAsync')(mode, ownerKey, target) },
  setWorkspaceOwnerLabel(ownerKey: string, label: string) { return requireCapability('setWorkspaceOwnerLabel')(ownerKey, label) },
  dropLeftoverProfilePrefs(profile: string, connectionId?: null | string) { return requireCapability('dropLeftoverProfilePrefs')(profile, connectionId) },
  get traceIdentityChange() { return getHostServices().traceIdentityChange },
  async deleteProfile(profile: string | PluginProfileRoute) { return requireCapability('deleteProfile')(profile) },
  async listPersistedSessions(route: PluginProfileRoute | null, options: { profile: string; limit?: number }) { return requireCapability('listPersistedSessions')(route, options) },
  async setPersistedSessionHidden(route: PluginProfileRoute | null, options: { sessionId: string; profile: string; hidden: boolean }) { return requireCapability('setPersistedSessionHidden')(route, options) },
  activeConnectionId(): null | string { return requireCapability('activeConnectionId')() },
  async profileRoutes() { return requireCapability('profileRoutes')() },
  async agents() { return requireCapability('agents')() },
  async connections() { return requireCapability('connections')() },
  async ensureAgent(connectionId: null | string | undefined, profile: string): Promise<void> { return requireCapability('ensureAgent')(connectionId, profile) },
  async retainProfile(route: PluginProfileRoute | string, options?: PluginProfileRequestOptions): Promise<() => void> { return requireCapability('retainProfile')(route, options) },
  retainProfileSocket(route: PluginProfileRoute | string): () => void { return requireCapability('retainProfileSocket')(route) },
  warmProfile(profile: string): void { requireCapability('warmProfile')(profile) },
  warmAgent(connectionId: null | string | undefined, profile: string): void { requireCapability('warmAgent')(connectionId, profile) },
  notify(input: NotificationInput): string { return requireCapability('notify')(input) },
  notifyError(error: unknown, fallback: string, options: { action?: NotificationAction; id?: string } = {}): string { return requireCapability('notifyError')(error, fallback, options) },
  onEvent(type: string, listener: (event: GatewayEvent) => void): () => void { return requireCapability('onEvent')(type, listener) },
  navigate(path: string): void { requireCapability('navigate')(path) },
  async request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    return requireCapability('request')<T>(method, params, timeoutMs)
  },
  async requestProfile<T>(route: PluginProfileRoute | string, method: string, params: Record<string, unknown> = {}, timeoutMs?: number, options?: PluginProfileRequestOptions): Promise<T> {
    return requestPluginProfile<T>(requireCapability('profileRequests'), route, method, params, timeoutMs, options)
  }
}
