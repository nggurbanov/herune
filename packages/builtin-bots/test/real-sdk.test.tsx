import React, { useEffect } from 'react'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { atom, Contribute, host, installHostServices, useValue } from '@hermes/plugin-sdk'

it('opens the actual Bot row through the actual SDK on its captured source', async () => {
  const calls: Array<{ connection: string; profile: string; method: string; params: Record<string, unknown> }> = []
  const open = vi.fn(async () => {})
  const roster = atom('ops')
  let listener: ((event: { type: string }) => void) | undefined
  let contribution: import('@hermes/plugin-sdk').Contribution | undefined
  let deliveries = 0
  let bundles: Record<string, unknown> = {}
  const translate = (key: string, ...args: unknown[]) => {
    const leaf = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], bundles)
    return typeof leaf === 'function' ? leaf(...args) : String(leaf ?? key)
  }
  const state = { activeSessionId: atom(null), awaitingResponse: atom(false), busy: atom(false), busyBySession: atom({}), connectionId: atom('local'), cwd: atom(''), focusedSessionId: atom(null), focusedSessionOwner: atom(null), focusedSessionProfile: atom('default'), focusedStoredSessionId: atom(null), gateway: atom('open'), model: atom(''), profile: atom('default') }
  const uninstall = installHostServices({
    registerContribution: c => { contribution = c; return () => { contribution = undefined } }, state,
    onEvent: (_type, callback) => { listener = callback; return () => { listener = undefined } },
    useI18n: () => ({ t: { common: { delete: 'Delete' }, sidebar: { row: {} } } } as ReturnType<NonNullable<import('@hermes/plugin-sdk').PluginHostServices['useI18n']>>),
    usePluginI18n: () => translate,
    usePaneVisible: () => true,
    notify: input => { throw new Error(input.detail || input.message) },
    SessionStatusDot: () => <span data-testid="status" />,
    onWindowStateChanged: () => () => {},
    haptic: () => {}, ackStoredSessionId: () => {}, setWorkspaceScope: () => true, setWorkspaceScopeAsync: async () => true,
    openSession: open, notifyError: error => { throw error },
    profileRequests: {
      profileNames: () => [], requestProfile: async () => { throw Error('wrong source') },
      requestAgent: async (connection, profile, method, params) => {
        calls.push({ connection, profile, method, params })
        if (method === 'session.list') return { sessions: [] }
        if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
        return {}
      }
    }
  })
  const bot = { name: 'ops', connectionId: 'remote-a', connectionKind: 'remote', connectionLabel: 'Remote A', sourceScoped: true, remoteSource: true, targetProfile: 'ops-target' } as const
  try {
    const { BOTS_LOCALES } = await import('../src/i18n')
    bundles = BOTS_LOCALES.en ?? {}
    const { BotRow } = await import('../src/bot-row')
    function Surface() {
      const name = useValue(roster)
      useEffect(() => host.onEvent('roster.changed', () => { deliveries++; roster.set('updated') }), [])
      return <><Contribute area="test" id="bots:test"><span>{name}</span></Contribute><BotRow bot={bot} onDelete={() => {}} onEdit={() => {}} onGroup={() => {}} onNewSection={() => {}} /></>
    }
    const view = render(<Surface />)
    const slot = render(<>{contribution?.render?.()}</>)
    expect(slot.getByText('ops')).toBeTruthy()
    listener?.({ type: 'roster.changed' })
    await waitFor(() => expect(slot.getByText('updated')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /ops/i }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(calls.filter(call => call.method === 'session.list').length).toBeGreaterThan(0)
    expect(calls.every(call => call.connection === 'remote-a' && call.profile === 'ops')).toBe(true)
    expect(calls.find(call => call.method === 'session.list')?.params).toMatchObject({ title: 'Bot Chat', profile: 'ops-target', include_hidden: true })
    expect(calls.find(call => call.method === 'session.title')?.params).toMatchObject({ session_id: 'runtime-1', title: 'Bot Chat' })
    expect(open).toHaveBeenCalledWith('stored-1', expect.objectContaining({ route: expect.objectContaining({ connectionId: 'remote-a', profile: 'ops', targetProfile: 'ops-target' }), tabTitle: 'Bot Chat' }))
    view.unmount()
    expect(contribution).toBeUndefined()
    expect(listener).toBeUndefined()
    expect(deliveries).toBe(1)
    slot.unmount()
    const { stopFaceClock } = await import('../src/avatar')
    stopFaceClock()
  } finally { uninstall() }
})
afterEach(cleanup)
