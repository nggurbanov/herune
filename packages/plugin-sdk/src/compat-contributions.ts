import type { ReactNode } from 'react'
import type { IconComponent } from './lib/icons'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const WORKSPACE_PAGE_HEADER_AREA = 'workspace.pageHeader'
export const SIDEBAR_NAV_PREFS_AREA = 'sidebarNav.prefs'
export const APPEARANCE_AREAS = { extra: 'appearance.extra' } as const
export const THEMES_AREA = 'themes'
export const KEYBINDS_AREA = 'keybinds'
export interface RouteContribution { path: string }
export interface SidebarNavContribution { codicon: string; label: string; path: string; tier?: 'advanced' | 'simple' }
export interface ProfileGroupHeaderContribution { render: (route: { connectionId: null | string; profile: string }) => ReactNode }
export interface SidebarNavPrefsContribution { hide?: string[]; order?: string[] }
export interface PaletteContribution {
  id: string; label: string; action?: string; icon?: IconComponent; keywords?: string[]; run: () => void
  detail?: () => string; detailVariant?: 'muted' | 'state'; keepOpen?: boolean
}
export interface KeybindContribution {
  id: string; category?: 'composer' | 'profiles' | 'session' | 'navigation' | 'view'
  defaults?: readonly string[]; label: string; run: () => void
}
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')
export function formatModifierToken(mod: string): string {
  if (mod === 'mod') return isMac ? '⌘' : 'Ctrl'
  if (mod === 'ctrl') return isMac ? '⌃' : 'Ctrl'
  if (mod === 'alt') return isMac ? '⌥' : 'Alt'
  if (mod === 'shift') return isMac ? '⇧' : 'Shift'
  return mod
}
export const MODEL_MENU_ROW_AREA = 'modelMenu.row'
export interface ModelMenuRowContext { label: string; model: string; provider: string }
export interface ModelMenuRowDecoration { badge?: string; icon?: ReactNode }
export interface ModelMenuRowContribution { decorate(row: ModelMenuRowContext): ModelMenuRowDecoration | null }

export type FloatingAnchor = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
