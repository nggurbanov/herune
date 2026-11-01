import type { ReadableAtom } from 'nanostores'
import type { UsageStats, ViewportRect } from './compat-host'
import type { PluginProfileRoute } from './profile-request'
import type { WorkspaceMode } from './contribution'
export interface PluginFocusedSessionOwner { connectionId: string; profile: string }
export interface PluginOpenSessionOptions {
  awaitHydration?: boolean; expectHistory?: boolean; forceResume?: boolean; hydrationTimeoutMs?: number
  intent?: 'in-place' | 'main' | 'stack' | 'tab' | 'window'
  keepAllProfilesScope?: boolean; refreshInPlace?: boolean; profile?: null | string; route?: PluginProfileRoute
  workspaceMode?: WorkspaceMode; workspaceOwnerKey?: string; retryHydrationTimeoutOnce?: boolean; tabTitle?: string
}
export interface PluginNewChatOptions { workspaceMode?: WorkspaceMode; workspaceOwnerKey?: string }
export interface PluginHostState {
  activeSessionId: ReadableAtom<null | string>; awaitingResponse: ReadableAtom<boolean>; busy: ReadableAtom<boolean>
  busyBySession: ReadableAtom<Record<string, boolean>>; connectionId: ReadableAtom<null | string>; cwd: ReadableAtom<string>
  focusedSessionId: ReadableAtom<null | string>; focusedSessionOwner: ReadableAtom<PluginFocusedSessionOwner | null>
  focusedSessionProfile: ReadableAtom<string>; focusedStoredSessionId: ReadableAtom<null | string>
  focusedUsage: ReadableAtom<UsageStats | null>; viewport: ReadableAtom<ViewportRect>
  gateway: ReadableAtom<string>; model: ReadableAtom<string>; profile: ReadableAtom<string>
}
export interface NotificationAction { label: string; onClick: () => void }
export interface NotificationInput {
  id?: string; kind?: 'error' | 'warning' | 'info' | 'success'; icon?: string; accentColor?: string; meta?: string
  title?: string; message: string; detail?: string; action?: NotificationAction; secondaryAction?: NotificationAction
  onDismiss?: () => void; durationMs?: number; placement?: 'default' | 'bottom-right'; persistent?: boolean
}
export type DesktopConnectionKind = 'cloud' | 'local' | 'remote' | 'ssh'
export interface DesktopRegistryConnection {
  id: string; kind: DesktopConnectionKind; label: string; url?: string; authMode?: 'oauth' | 'token'
  org?: string; host?: string; user?: string; port?: number; keyPath?: string; remoteHermesPath?: string
  remoteProfile?: string; tokenSet: boolean; tokenPreview: null | string; headerNames?: string[]; installId?: string
}
export interface DesktopRosterAgent {
  connectionId: string; connectionKind: DesktopConnectionKind; connectionLabel: string; profile: string
  targetProfile?: string; handle: string; reachable?: boolean
}
export interface DesktopAgentRoster {
  agents: DesktopRosterAgent[]; primaryConnectionId?: string
  sources: { connectionId: string; label: string; kind: DesktopConnectionKind; reachable: boolean; error?: string; needsSignIn?: boolean; installId?: string }[]
}
export interface PaginatedSessions { limit: number; offset: number; sessions: import('./session-info').SessionInfo[]; total: number; profile_totals?: Record<string, number>; errors?: Array<{ profile: string; error: string }>; storage?: Record<string, 'corrupt'> }
export interface WorkspaceOpenOptions {
  dock?: { before?: null | string; pane: string; pos: 'bottom' | 'center' | 'left' | 'right' | 'top' }
  headerVeto?: boolean; minWidth?: string; onClose?: () => void; render: () => import('react').ReactNode; title?: string; uncloseable?: boolean
}
export type WorkspaceNewSessionTarget = { kind: 'blocked'; message: string } | { kind: 'route'; route: { connectionId: string; mode?: 'local' | 'remote'; profile: string; targetProfile?: string } }
