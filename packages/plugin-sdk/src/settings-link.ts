/** Settings plugin routes share the desktop's URL parameter encoding. */
export const SETTINGS_PLUGINS_AREA = 'settings.plugins'
export function pluginSettingsHref(plugin?: string, page?: string): string {
  const params = new URLSearchParams({ tab: 'plugins' })
  if (plugin) {
    params.set('plugin', plugin)
    if (page) params.set('ppage', page)
  }
  return `/settings?${params}`
}
