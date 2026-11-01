import { describe, expect, it, vi } from 'vitest'
import { createPluginRuntime } from '../../src/plugin-runtime'
import type { RuntimeContextServices } from '../../src/plugin-runtime'
import type { GatewayEvent } from '@hermes/shared/gateway-events'
const unavailable = (): never => { throw new Error('not available in synthetic host') }

const dataUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

describe('runtime boundary', () => {
  it('loads real static and dynamic modules, scopes state and disposes each resource once', async () => {
    const values = new Map<string, string>()
    const contributions = new Map<string, unknown>()
    const listeners = new Set<(event: GatewayEvent) => void>()
    const cleanup = vi.fn()
    const requests = vi.fn(async (method: string) => ({ method }))
    const host = { request: requests, state: { marker: 'profile-a' }, registerContribution(c: { id: string }) { contributions.set(c.id, c); return () => { contributions.delete(c.id); cleanup() } }, onEvent(_type: string, listener: (event: GatewayEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); cleanup() } } }
    Object.assign(globalThis, { __runtimeTestHost: host })
    const sdk = dataUrl('export const host = globalThis.__runtimeTestHost;')
    const services: RuntimeContextServices = {
      host: { registerContribution: host.registerContribution, onEvent: host.onEvent },
      readKey: (key: string) => values.get(key) ?? null,
      writeKey: (key: string, value: string | null) => { if (value === null) values.delete(key); else values.set(key, value) },
      createDoors: () => ({ rest: async <T>(path: string): Promise<T> => JSON.parse(JSON.stringify({ path, profile: 'profile-a' })), socket: () => () => cleanup(), os: { notify: unavailable, openExternal: unavailable, revealPath: unavailable, pickSavePath: unavailable, pickOpenPath: unavailable, writeClipboard: unavailable }, pet: { say: unavailable, clear: unavailable, get visible() { return unavailable() } }, preview: { isAvailable: unavailable, executeJavaScript: unavailable }, files: { dataFolder: 'data', requestFolder: unavailable, folders: unavailable, release: unavailable, list: unavailable, stat: unavailable, readText: unavailable, readDataUrl: unavailable, writeText: unavailable, rename: unavailable, trash: unavailable }, i18n: { register: unavailable, t: unavailable, onLocaleChange: unavailable, registerAppLocale: unavailable }, runAction: unavailable, listActions: unavailable })
    }
    const runtime = createPluginRuntime(services, { importMap: { '@hermes/plugin-sdk': sdk }, createModuleUrl: dataUrl, revokeModuleUrl: () => {}, importModule: url => import(/* @vite-ignore */ url) })
    const source = `import { host } from '@hermes/plugin-sdk';
      export default { id: 'sample', async register(ctx) {
        globalThis.__oldContext = ctx;
        ctx.register({ id: 'row', area: 'test' });
        ctx.onEvent('*', () => globalThis.__events++);
        ctx.onDispose(() => globalThis.__disposed++);
        ctx.storage.set('v', {owner: host.state.marker});
        globalThis.__request = await host.request('test', {});
        globalThis.__rest = await ctx.rest('/board');
        globalThis.__dynamic = (await import('@hermes/plugin-sdk')).host === host;
      }};`
    Object.assign(globalThis, { __events: 0, __disposed: 0 })
    const loaded = await runtime.load(source, 'test')
    await vi.waitFor(() => expect(Reflect.get(globalThis, '__dynamic')).toBe(true))
    expect(requests).toHaveBeenCalledOnce()
    expect(Reflect.get(globalThis, '__request')).toEqual({ method: 'test' })
    expect(Reflect.get(globalThis, '__rest')).toEqual({ path: '/board', profile: 'profile-a' })
    expect(values.get('hermes.plugin.sample.v')).toBe('{"owner":"profile-a"}')
    expect(contributions.get('sample:row')).toMatchObject({ source: 'plugin:sample' })
    expect(listeners.size).toBe(1)
    listeners.forEach(listener => listener({ type: 'session.replay_gap', payload: {}, profile: 'profile-a' }))
    expect(Reflect.get(globalThis, '__events')).toBe(1)
    const stale = Reflect.get(globalThis, '__oldContext')
    loaded.deactivate(); loaded.deactivate()
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(Reflect.get(globalThis, '__disposed')).toBe(1)
    expect(listeners.size).toBe(0)
    loaded.activate()
    expect(() => stale.register({ id: 'late', area: 'test' })).toThrow(/disposed/)
    expect(() => stale.storage.set('v', 9)).toThrow(/disposed/)
    expect(contributions.has('sample:row')).toBe(true)
    const replacement = await runtime.load(source, 'test')
    loaded.deactivate()
    expect(contributions.has('sample:row')).toBe(true)
    replacement.deactivate()
    expect(contributions.size).toBe(0)
  })
  it('rejects unsupported imports before evaluating the module', async () => {
    const importer = vi.fn()
    const runtime = createPluginRuntime({ host: { registerContribution: unavailable }, readKey: unavailable, writeKey: unavailable, createDoors: unavailable }, { importMap: {}, createModuleUrl: dataUrl, revokeModuleUrl: () => {}, importModule: importer })
    await expect(runtime.load(`import 'other'; export default {}`, 'bad')).rejects.toThrow(/unsupported imports: other/)
    expect(importer).not.toHaveBeenCalled()
  })
})
