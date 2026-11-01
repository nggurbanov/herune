import { requireCapability } from '../services'
import type { DesktopTheme } from './types'
export type ThemeMode = 'light' | 'dark' | 'system'
export interface ThemeContextValue {
  theme: DesktopTheme; themeName: string; mode: ThemeMode; resolvedMode: 'light' | 'dark'; renderedMode: 'light' | 'dark'
  availableThemes: Array<{ name: string; label: string; description: string }>
  setTheme(name: string): void; setMode(mode: ThemeMode): void
  previewTheme(name: string, mode: 'light' | 'dark'): void; clearThemePreview(): void
}
export function useTheme(): ThemeContextValue { return requireCapability('useTheme')() }
export function requestTheme(name: string): boolean { return requireCapability('requestTheme')(name) }
