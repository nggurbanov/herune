import { expect, it, vi } from 'vitest'
import { host, installHostServices } from '../src/index'

it('forwards the complete owner and request options through the host', async () => {
  const requestAgent = vi.fn(async () => 'ok')
  const uninstall = installHostServices({ registerContribution: () => () => {}, profileRequests: {
    requestProfile: vi.fn(), requestAgent, profileNames: () => []
  } })
  const route = { connectionId: 'synthetic-source', mode: 'remote' as const, profile: 'bot', targetProfile: 'bot' }
  expect(await host.requestProfile(route, 'session.list', { title: 'Bot Chat' }, 500, { spawnPriority: 'foreground' })).toBe('ok')
  expect(requestAgent).toHaveBeenCalledWith('synthetic-source', 'bot', 'session.list', { title: 'Bot Chat' }, 500, undefined, { spawnPriority: 'foreground' })
  uninstall()
  await expect(host.request('x')).rejects.toThrow('Plugin host services have not been installed')
})

it('delivers and disposes a host event subscription', () => {
  const listeners = new Set<(event: any) => void>()
  const uninstall = installHostServices({ registerContribution: () => () => {}, onEvent: (_type, listener) => { listeners.add(listener); return () => listeners.delete(listener) } })
  const listener = vi.fn()
  const dispose = host.onEvent('gateway.reconnecting', listener)
  const event = { type: 'gateway.reconnecting' as const, connectionId: 'source-b', payload: { attempt: 1 } }
  listeners.forEach(fn => fn(event))
  expect(listener).toHaveBeenCalledWith(event)
  dispose()
  listeners.forEach(fn => fn(event))
  expect(listener).toHaveBeenCalledTimes(1)
  uninstall()
})

it('reports an optional identity trace only when the host provides it', () => {
  const absent = installHostServices({ registerContribution: () => () => {} })
  try {
    expect(host.traceIdentityChange).toBeUndefined()
    expect(() => host.traceIdentityChange?.('bots', 'id', 'event')).not.toThrow()
  } finally { absent() }
  const trace = vi.fn()
  const present = installHostServices({ registerContribution: () => () => {}, traceIdentityChange: trace })
  try {
    host.traceIdentityChange?.('bots', 'id', 'event')
    expect(trace).toHaveBeenCalledWith('bots', 'id', 'event')
  } finally { present() }
})

it('reports browser-only profile cleanup only when the host provides it', () => {
  const absent = installHostServices({ registerContribution: () => () => {} })
  try {
    expect(host.dropLeftoverProfilePrefs).toBeUndefined()
  } finally { absent() }
  const cleanup = vi.fn()
  const present = installHostServices({ registerContribution: () => () => {}, dropLeftoverProfilePrefs: cleanup })
  try {
    host.dropLeftoverProfilePrefs?.('work', 'source-a')
    expect(cleanup).toHaveBeenCalledWith('work', 'source-a')
  } finally { present() }
})
