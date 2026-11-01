/** Connection-qualified authority for a plugin request. */
export interface PluginProfileRoute {
  connectionId: string
  mode: 'local' | 'remote'
  primary?: true
  profile: string
  targetProfile: string
}
export interface PluginProfileRequestOptions { spawnPriority?: 'foreground' | 'background' }

/** Host-provided capabilities. No ambient route or global bridge is assumed. */
export interface ProfileRequestHost {
  requestProfile<T>(profile: string, method: string, params: Record<string, unknown>, timeoutMs?: number, unused?: undefined, options?: PluginProfileRequestOptions): Promise<T>
  requestAgent<T>(connectionId: string, profile: string, method: string, params: Record<string, unknown>, timeoutMs?: number, unused?: undefined, options?: PluginProfileRequestOptions): Promise<T>
  getAgentRoster?: () => Promise<{ sources: Array<{ kind: string }> }>
  getProfileRoutes?: (profiles: string[]) => Promise<PluginProfileRoute[]>
  profileNames(): string[]
}

/** Preserve the legacy string overload only when the source is unambiguous. */
export async function requestPluginProfile<T>(host: ProfileRequestHost, route: PluginProfileRoute | string, method: string, params: Record<string, unknown>, timeoutMs?: number, options?: PluginProfileRequestOptions): Promise<T> {
  const priority = options?.spawnPriority
  const dial = (profile: string): Promise<T> => priority
    ? host.requestProfile<T>(profile, method, params, timeoutMs, undefined, { spawnPriority: priority })
    : timeoutMs === undefined ? host.requestProfile<T>(profile, method, params) : host.requestProfile<T>(profile, method, params, timeoutMs)
  if (typeof route !== 'string') {
    if (!route.connectionId.trim() || !route.profile.trim() || !route.targetProfile.trim()) throw new Error('Profile route must include connectionId, profile, and targetProfile')
    if (priority) return host.requestAgent<T>(route.connectionId, route.profile, method, params, timeoutMs, undefined, { spawnPriority: priority })
    return timeoutMs === undefined ? host.requestAgent<T>(route.connectionId, route.profile, method, params) : host.requestAgent<T>(route.connectionId, route.profile, method, params, timeoutMs)
  }
  if (!host.getAgentRoster) return dial(route)
  const roster = await host.getAgentRoster()
  const profile = route.trim() || 'default'
  if (roster.sources.length === 1 && roster.sources[0]?.kind === 'local') return dial(profile)
  throw new Error(`Profile "${profile}" requires a route descriptor from host.profileRoutes(); profile-only routing is limited to legacy/local profiles.`)
}

/** Revalidate the entire owner before retrying a wake. */
export async function pluginRouteStillRegistered(host: ProfileRequestHost, route: PluginProfileRoute): Promise<boolean> {
  if (!host.getProfileRoutes) return false
  try {
    const routes = await host.getProfileRoutes(host.profileNames())
    return routes.some(candidate => candidate.connectionId === route.connectionId && candidate.profile === route.profile && candidate.targetProfile === route.targetProfile)
  } catch { return false }
}
