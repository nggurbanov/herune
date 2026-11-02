import { atom, installHostServices } from '@hermes/plugin-sdk'
import { expect, it, vi } from 'vitest'

const state = { activeSessionId: atom(null), awaitingResponse: atom(false), busy: atom(false), busyBySession: atom({}), connectionId: atom('local'), cwd: atom(''), focusedSessionId: atom(null), focusedSessionOwner: atom(null), focusedSessionProfile: atom('default'), focusedStoredSessionId: atom(null), gateway: atom('open'), model: atom(''), profile: atom('default') }

it('keeps handling bot activity when the host has no unread marker', async () => {
  const notify = vi.fn(() => 'notice')
  const uninstall = installHostServices({ registerContribution: () => () => {}, state, notify })
  try {
    const { trackInboundActivity, $activityToasts } = await import('../src/roster-actions')
    const bot = { name: 'background', canonical_session: { id: 'bot-chat', last_active: 10, preview: 'first' } }
    $activityToasts.set(true)
    trackInboundActivity([bot])
    expect(() => trackInboundActivity([{ ...bot, canonical_session: { ...bot.canonical_session, last_active: 20, preview: 'new activity' } }])).not.toThrow()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'new activity' }))
  } finally { uninstall() }
})

it('finishes local cleanup after a confirmed bot deletion without unread support', async () => {
  const remove = vi.fn(async () => {})
  const uninstall = installHostServices({ registerContribution: () => () => {}, state, deleteProfile: remove })
  try {
    const { deleteBot } = await import('../src/profile-ops')
    const { $selectedBot, rosterWatermarks } = await import('../src/bot-state')
    const { botSelectionKey } = await import('../src/data')
    const bot = { name: 'work', canonical_session: { id: 'work-chat', last_active: 10 } }
    const key = botSelectionKey(bot)
    $selectedBot.set(key)
    rosterWatermarks.set(key, 10)
    await expect(deleteBot(bot)).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledOnce()
    expect($selectedBot.get()).toBe('default')
    expect(rosterWatermarks.has(key)).toBe(false)
  } finally { uninstall() }
})

it('still records unread when the host provides the capability', async () => {
  const mark = vi.fn()
  const uninstall = installHostServices({ registerContribution: () => () => {}, state, markSessionUnreadFinished: mark })
  try {
    const { trackInboundActivity, $activityToasts } = await import('../src/roster-actions')
    const bot = { name: 'supported', canonical_session: { id: 'supported-chat', last_active: 10, preview: 'first' } }
    $activityToasts.set(false)
    trackInboundActivity([bot])
    trackInboundActivity([{ ...bot, canonical_session: { ...bot.canonical_session, last_active: 20 } }])
    expect(mark).toHaveBeenCalledWith('supported-chat', 'supported')
  } finally { uninstall() }
})

it('does not retire a bot when its backend deletion fails', async () => {
  const uninstall = installHostServices({ registerContribution: () => () => {}, state, deleteProfile: async () => { throw new Error('refused') } })
  try {
    const { deleteBot } = await import('../src/profile-ops')
    const { $selectedBot } = await import('../src/bot-state')
    const { botSelectionKey } = await import('../src/data')
    const bot = { name: 'retained', canonical_session: { id: 'retained-chat', last_active: 10 } }
    const key = botSelectionKey(bot)
    $selectedBot.set(key)
    await expect(deleteBot(bot)).rejects.toThrow('refused')
    expect($selectedBot.get()).toBe(key)
  } finally { uninstall() }
})

it('duplicates a bot exactly once when browser-only profile cleanup is unavailable', async () => {
  const requestAgent = vi.fn(async (_source: string, _profile: string, method: string) => {
    if (method === 'profiles.list') return { profiles: [{ name: 'work' }] }
    if (method === 'profiles.create') return { ok: true, name: 'work-2' }
    throw new Error(`unexpected ${method}`)
  })
  const uninstall = installHostServices({ registerContribution: () => () => {}, state, profileRequests: {
    requestAgent, requestProfile: async () => { throw new Error('wrong route') }, profileNames: () => []
  } })
  try {
    const { duplicateBot } = await import('../src/profile-ops')
    const { $botMeta } = await import('../src/data')
    $botMeta.set({})
    const bot = { name: 'work', connectionId: 'source-a', connectionKind: 'remote', sourceScoped: true, targetProfile: 'work' }
    await expect(duplicateBot(bot, [bot])).resolves.toBe('work-2')
    expect(requestAgent.mock.calls.filter(call => call[2] === 'profiles.create')).toHaveLength(1)
    expect(requestAgent.mock.calls.every(call => call[0] === 'source-a' && call[1] === 'work')).toBe(true)
  } finally { uninstall() }
})
