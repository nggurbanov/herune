import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { atom, installHostServices } from '@hermes/plugin-sdk'
import { expect, it, vi } from 'vitest'

it('creates a bot once from the actual dialog when browser-only cleanup is unavailable', async () => {
  const calls: Array<{method: string; params: Record<string, unknown>}> = []
  const close = vi.fn()
  const state = { activeSessionId: atom(null), awaitingResponse: atom(false), busy: atom(false), busyBySession: atom({}), connectionId: atom('local'), cwd: atom(''), focusedSessionId: atom(null), focusedSessionOwner: atom(null), focusedSessionProfile: atom('default'), focusedStoredSessionId: atom(null), gateway: atom('open'), model: atom(''), profile: atom('default') }
  const { BOTS_LOCALES } = await import('../src/i18n')
  const bundle = BOTS_LOCALES.en ?? {}
  const translate = (key: string, ...args: unknown[]) => {
    const leaf = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], bundle)
    return typeof leaf === 'function' ? leaf(...args) : String(leaf ?? key)
  }
  const uninstall = installHostServices({
    registerContribution: () => () => {}, state,
    useI18n: () => ({ t: { common: { cancel: 'Cancel' } } } as any),
    usePluginI18n: () => translate,
    connections: async () => [], onWindowStateChanged: () => () => {}, haptic: () => {},
    notify: () => 'notice', notifyError: () => 'error', newChat: () => {},
    request: async (method, params) => {
      calls.push({ method, params })
      if (method === 'profiles.create') return { ok: true, name: 'fresh-bot' } as any
      if (method === 'setup.runtime_check') return { ok: false } as any
      if (method === 'session.list') return { sessions: [] } as any
      if (method === 'session.create') return { session_id: 'r1', stored_session_id: 's1' } as any
      return { ok: true } as any
    }
  })
  try {
    const { CreateAgentDialog } = await import('../src/create-dialog')
    const view = render(<CreateAgentDialog open onClose={close} roster={[]} />)
    fireEvent.change(view.getByPlaceholderText('inbox-triage'), { target: { value: 'fresh-bot' } })
    fireEvent.click(view.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(calls.filter(call => call.method === 'profiles.create')).toHaveLength(1))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(calls.filter(call => call.method === 'profiles.create')).toHaveLength(1)
    expect(calls.find(call => call.method === 'profiles.create')?.params).toMatchObject({ name: 'fresh-bot' })
    view.unmount()
  } finally { cleanup(); (await import('../src/avatar')).stopFaceClock(); uninstall() }
})
