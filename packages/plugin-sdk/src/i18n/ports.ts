import type { FlatMessages, TranslationOverride } from '@hermes/shared/i18n'
import { requireCapability } from '../services'
import type { Locale, Translations } from './types'

export interface I18nContextValue {
  configLoadError: Error | null
  isLoadingConfig: boolean
  isSavingLocale: boolean
  locale: Locale
  saveError: Error | null
  setLocale: (next: Locale) => Promise<void>
  t: Translations
}
export type PluginMessageValue = string | ((...args: never[]) => string)
export interface PluginMessages { [key: string]: PluginMessages | PluginMessageValue }
export type PluginLocaleBundles = Partial<Record<import('./types').BundledLocale, PluginMessages>> & { [locale: Locale]: PluginMessages | undefined }
export type PluginTranslate = (key: string, ...args: unknown[]) => string
export function useI18n(): I18nContextValue { return requireCapability('useI18n')() }
export function usePluginI18n(id: string): PluginTranslate { return requireCapability('usePluginI18n')(id) }
export function translateNow(key: string, ...args: unknown[]): string { return requireCapability('translateNow')(key, ...args) }

export interface AppLocaleRegistration {
  endonym?: string
  englishName?: string
  rtl?: boolean
  translations?: FlatMessages | Record<string, unknown> | TranslationOverride<Translations>
}
export interface PluginI18n {
  register: (bundles: PluginLocaleBundles) => () => void
  t: PluginTranslate
  onLocaleChange: (listener: () => void) => () => void
  registerAppLocale: (id: string, registration: AppLocaleRegistration) => () => void
}

export function useKeybindHint(actionId: string): string | null { return requireCapability('useKeybindHint')(actionId) }

export function usePaneVisible(): boolean { return requireCapability('usePaneVisible')() }

export interface LanguageOption { id: Locale; endonym: string; englishName?: string; rtl: boolean; source: 'bundled' | 'app' | 'backend' | `plugin:${string}` }
