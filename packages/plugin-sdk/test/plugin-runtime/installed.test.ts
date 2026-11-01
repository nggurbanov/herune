import { expect, it, vi } from 'vitest'
import * as sdk from '../../src/index'
import * as React from 'react'
import { installPluginSdk } from '../../src/runtime'
import type { RuntimeContextServices } from '../../src/plugin-runtime'
import type { GatewayEvent } from '@hermes/shared/gateway-events'

const unavailable = (): never => { throw new Error('not available in synthetic host') }
const url = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

it('activates a real SDK module against the installed source-qualified host and retires it', async () => {
  const listeners = new Set<(event: GatewayEvent) => void>()
  const contributions = new Map<string, sdk.Contribution>()
  const values = new Map<string, string>()
  const profile = sdk.atom('ops')
  const state = { activeSessionId: sdk.atom(null), awaitingResponse: sdk.atom(false), busy: sdk.atom(false), busyBySession: sdk.atom({}), connectionId: sdk.atom('local'), cwd: sdk.atom(''), focusedSessionId: sdk.atom(null), focusedSessionOwner: sdk.atom(null), focusedSessionProfile: profile, focusedStoredSessionId: sdk.atom(null), gateway: sdk.atom('open'), model: sdk.atom(''), profile }
  const requests = vi.fn(async (connection: string, profile: string, method: string) => ({ connection, profile, method }))
  const uninstall = sdk.installHostServices({
    state,
    registerContribution(c) { contributions.set(c.id, c); return () => { contributions.delete(c.id) } },
    onEvent(_type, listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    profileRequests: { profileNames: () => [], requestProfile: unavailable, requestAgent: requests }
  })
  installPluginSdk()
  const sdkShim = url('export const host = globalThis.__HERMES_PLUGIN_SDK__.host; export const atom = globalThis.__HERMES_PLUGIN_SDK__.atom; export const queryClient = globalThis.__HERMES_PLUGIN_SDK__.queryClient;')
  const reactShim = url('export const useState = globalThis.__HERMES_REACT__.useState;')
  const services: Omit<RuntimeContextServices, 'host'> = {
    readKey: key => values.get(key) ?? null,
    writeKey: (key, value) => { if (value === null) values.delete(key); else values.set(key, value) },
    createDoors: () => ({ rest: unavailable, socket: unavailable, os: { notify: unavailable, openExternal: unavailable, revealPath: unavailable, pickSavePath: unavailable, pickOpenPath: unavailable, writeClipboard: unavailable }, pet: { say: unavailable, clear: unavailable, get visible() { return unavailable() } }, preview: { isAvailable: unavailable, executeJavaScript: unavailable }, files: { dataFolder: 'data', requestFolder: unavailable, folders: unavailable, release: unavailable, list: unavailable, stat: unavailable, readText: unavailable, readDataUrl: unavailable, writeText: unavailable, rename: unavailable, trash: unavailable }, i18n: { register: unavailable, t: unavailable, onLocaleChange: unavailable, registerAppLocale: unavailable }, runAction: unavailable, listActions: unavailable })
  }
  const runtime = sdk.createInstalledPluginRuntime(services, { importMap: { '@hermes/plugin-sdk': sdkShim, react: reactShim }, createModuleUrl: url, revokeModuleUrl: () => {}, importModule: path => import(/* @vite-ignore */ path) })
  Object.assign(globalThis, { __installedEvents: 0, __expectedUseState: React.useState, __expectedQueryClient: sdk.queryClient })
  try {
    const loaded = await runtime.load(`import {host, atom, queryClient} from '@hermes/plugin-sdk'; import {useState} from 'react';
      export default {id:'scoped', async register(ctx) {
        globalThis.__installedContext = ctx;
        globalThis.__sameReact = useState === globalThis.__expectedUseState;
        globalThis.__sameQuery = queryClient === globalThis.__expectedQueryClient;
        globalThis.__hostProfile = host.state.profile.get();
        globalThis.__sdkState = atom('ready').get();
        ctx.storage.set('source', 'remote-a'); ctx.register({id:'row',area:'test'});
        ctx.onEvent('*', () => globalThis.__installedEvents++);
        globalThis.__scopedResult = await host.requestProfile({connectionId:'remote-a',mode:'remote',profile:'ops',targetProfile:'ops-target'}, 'session.list', {});
      }};`, 'synthetic')
    await vi.waitFor(() => expect(Reflect.get(globalThis, '__scopedResult')).toEqual({ connection: 'remote-a', profile: 'ops', method: 'session.list' }))
    expect(Reflect.get(globalThis, '__sameReact')).toBe(true)
    expect(Reflect.get(globalThis, '__sdkState')).toBe('ready')
    expect(Reflect.get(globalThis, '__sameQuery')).toBe(true)
    expect(Reflect.get(globalThis, '__hostProfile')).toBe('ops')
    profile.set('other')
    expect(requests.mock.calls[0]?.slice(0, 2)).toEqual(['remote-a', 'ops'])
    expect(values.get('hermes.plugin.scoped.source')).toBe('"remote-a"')
    expect(contributions.get('scoped:row')).toMatchObject({ source: 'plugin:scoped' })
    listeners.forEach(listener => listener({ type: 'session.replay_gap', payload: {}, profile: 'ops' }))
    expect(Reflect.get(globalThis, '__installedEvents')).toBe(1)
    const stale = Reflect.get(globalThis, '__installedContext')
    loaded.deactivate()
    expect(listeners.size).toBe(0)
    expect(contributions.size).toBe(0)
    expect(() => stale.storage.get('source')).toThrow(/disposed/)
    loaded.activate()
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2))
    uninstall()
    expect(listeners.size).toBe(0)
    expect(contributions.size).toBe(0)
    expect(() => loaded.activate()).toThrow(/disposed/)
  } finally { uninstall() }
})
