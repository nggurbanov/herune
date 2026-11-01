/** Types retained from the desktop plugin host contract. Host adapters own persistence and validation. */
export interface ViewportRect { width: number; height: number; narrow: boolean }
export interface UsageStats {
  avg_tps?: number; cache_hit_pct?: number; calls: number; compressions?: number
  context_max?: number; context_percent?: number; context_estimated?: boolean; context_source?: string
  context_used?: number; cost_usd?: number; input: number; output: number
  plan_gauge?: { id: string; label: string; resets_at_ms?: null | number; used_bp: number }; total: number
}
export interface DesktopSettingValues {
  'backdrop.v1': boolean
  chatTextScale: 90 | 100 | 110 | 125 | 150 | 175
  'composerPopout.gesturesEnabled': boolean
  'intro-splash.v1': boolean
  'reasoning.collapsedByDefault': boolean
  sessionListDensity: 'compact' | 'comfortable' | 'detailed'
  tabStripDefault: 'auto' | 'always' | 'never'
}
export type DesktopSettingKey = keyof DesktopSettingValues
export interface DesktopSettings {
  get<K extends DesktopSettingKey>(key: K): DesktopSettingValues[K]
  set<K extends DesktopSettingKey>(key: K, value: DesktopSettingValues[K]): void
  subscribe<K extends DesktopSettingKey>(key: K, listener: (value: DesktopSettingValues[K]) => void): () => void
}
export interface SessionActions {
  pin(storedSessionId: string, pinned?: boolean, index?: number): void
  reorder(ids: string[]): void
  reorderPinned(ids: string[]): void
  setColor(storedSessionId: string, color: null | string): void
}
export interface ComposerActions {
  getDraft(sessionId?: null | string): Promise<null | string>
  setDraft(sessionId: null | string, text: string): Promise<boolean>
  insertText(sessionId: null | string, text: string, opts?: { mode?: 'block' | 'inline' | 'prefix' }): Promise<boolean>
  submit(sessionId: null | string, text: string): boolean
  focus(sessionId?: null | string): void
}
export interface SpellcheckActions { addWord(word: string): Promise<boolean>; removeWord(word: string): Promise<boolean> }
export interface SkillInfo { category: string; description: string; enabled: boolean; name: string; usage?: number; provenance?: 'agent' | 'bundled' | 'external' | 'hub' }
export interface ToolsetInfo { configured: boolean; description: string; enabled: boolean; label: string; name: string; tools: string[] }
export interface ProfileInfo { display_name?: string; bot_title?: string; has_env: boolean; is_default: boolean; model: null | string; name: string; path: string; provider: null | string; skill_count: number }
export interface ProfilesResponse { profiles: ProfileInfo[] }
export interface LogsResponse { file: string; lines: string[] }
export interface StatusResponse {
  shared_profile_warning?: boolean; active_sessions: number; config_path: string; config_version: number
  env_path: string; gateway_exit_reason: string | null; gateway_health_url: string | null
  gateway_heartbeat_stale_s?: number | null; gateway_pid: number | null
  gateway_platforms: Record<string, { error_code?: string; error_message?: string; state: string; updated_at: string }>
  gateway_running: boolean; gateway_shared_with?: string[] | null; gateway_state: string | null
  gateway_updated_at: string | null; hermes_home: string; latest_config_version: number; release_date: string; version: string
}
