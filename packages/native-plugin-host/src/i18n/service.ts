/** English catalogue and plugin locale registration adapted from Desktop i18n at
 * 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT). */
import { useSyncExternalStore } from 'react'
import type { PluginI18n, PluginLocaleBundles, PluginTranslate } from '../../../plugin-sdk/src/i18n/ports'
import { en } from './en'
export function createI18n() {
  const bundles = new Map<string, PluginLocaleBundles>()
  const listeners = new Set<() => void>()
  let revision = 0
  const change = () => { revision++; listeners.forEach(listener => listener()) }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const get = (root: unknown, key: string, args: unknown[]) => {
    let value: any = root
    for (const part of key.split('.')) value = value?.[part]
    return typeof value === 'function' ? value(...args) : typeof value === 'string' ? value : key
  }
  const translateNow: PluginTranslate = (key, ...args) => get(en, key, args)
  const pluginTranslate = (id: string): PluginTranslate => (key, ...args) => get(bundles.get(id)?.en, key, args)
  return {
    translateNow,
    useI18n() { useSyncExternalStore(subscribe, () => revision); return { t: en, locale: 'en' as const, configLoadError: null, isLoadingConfig: false, isSavingLocale: false, saveError: null, setLocale: async () => { throw new Error('Native locale switching is unavailable') } } },
    usePluginI18n(id: string) { useSyncExternalStore(subscribe, () => revision); return pluginTranslate(id) },
    plugin(id: string): PluginI18n {
      return {
        register(next) { bundles.set(id, next); change(); return () => { if (bundles.get(id) === next) { bundles.delete(id); change() } } },
        t: pluginTranslate(id), onLocaleChange: subscribe,
        registerAppLocale: () => { throw new Error('Native app locale registration is unavailable') }
      }
    }
  }
}
