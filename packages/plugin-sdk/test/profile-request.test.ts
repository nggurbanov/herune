import { describe, expect, it, vi } from 'vitest'
import { planPluginOpenSession, pluginRouteStillRegistered, requestPluginProfile, type ProfileRequestHost, type PluginProfileRoute } from '../src/index'
const route: PluginProfileRoute = { connectionId: 'source-b', profile: 'research', targetProfile: 'remote-research', mode: 'remote' }
function fixture() {
  const requestProfile = vi.fn(async () => 'profile')
  const requestAgent = vi.fn(async () => 'agent')
  const host = { requestProfile, requestAgent, profileNames: () => ['research'] } as unknown as ProfileRequestHost
  return { host, requestProfile, requestAgent }
}
describe('profile authority', () => {
  it('routes exact owners and forwards priority and deadline', async () => {
    const { host, requestAgent } = fixture()
    expect(await requestPluginProfile(host, route, 'session.list', { title: 'Bot Chat' }, 3000, { spawnPriority: 'foreground' })).toBe('agent')
    expect(requestAgent).toHaveBeenCalledWith('source-b', 'research', 'session.list', { title: 'Bot Chat' }, 3000, undefined, { spawnPriority: 'foreground' })
    await expect(requestPluginProfile(host, { ...route, targetProfile: '' }, 'x', {})).rejects.toThrow('Profile route must include')
  })
  it('rejects ambiguous profile-only requests and permits sole local source', async () => {
    const { host, requestProfile } = fixture()
    host.getAgentRoster = async () => ({ sources: [{ kind: 'local' }, { kind: 'remote' }] })
    await expect(requestPluginProfile(host, 'research', 'x', {})).rejects.toThrow('requires a route descriptor')
    host.getAgentRoster = async () => ({ sources: [{ kind: 'local' }] })
    await requestPluginProfile(host, ' research ', 'x', {})
    expect(requestProfile).toHaveBeenCalledWith('research', 'x', {})
  })
  it('fails closed if the owner changed or the registry fails', async () => {
    const { host } = fixture()
    host.getProfileRoutes = async () => [route]
    expect(await pluginRouteStillRegistered(host, route)).toBe(true)
    host.getProfileRoutes = async () => [{ ...route, targetProfile: 'other' }]
    expect(await pluginRouteStillRegistered(host, route)).toBe(false)
    host.getProfileRoutes = async () => { throw new Error('offline') }
    expect(await pluginRouteStillRegistered(host, route)).toBe(false)
  })
  it('keeps plugin navigation from stealing workspace ownership', () => {
    expect(planPluginOpenSession({ profile: 'research', activeProfile: 'default' })).toEqual({ dialWithoutSwitching: 'research', requireActiveProfileForHydration: false, showAllProfiles: true, switchWorkspace: null })
    expect(planPluginOpenSession({ profile: 'research', activeProfile: 'default', keepAllProfilesScope: false }).switchWorkspace).toBe('research')
  })
})
