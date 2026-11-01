import { expect, it } from 'vitest'
import { installHostServices } from '@hermes/plugin-sdk'
import { prepareCanonicalGroupSend, readCanonicalGroupSend, retireCanonicalGroupSend } from '../src/canonical-group-send'

it('converges competing prepared sends and only retires the acknowledged owner', async () => {
  const journal: Record<string, unknown> = {}
  const uninstall = installHostServices({
    registerContribution: () => () => {},
    preparedSubmissions: {
      async read() { return JSON.stringify(journal) },
      async compareAndSet(key, expected, entry) {
        const current = Object.hasOwn(journal, key) ? JSON.stringify(journal[key]) : null
        if (current !== expected) return { applied: false, current }
        if (entry === null) delete journal[key]
        else journal[key] = JSON.parse(entry)
        return { applied: true, current: entry }
      }
    }
  })
  const owner = { connectionId: 'remote', profile: 'ops', roomId: 'room' }
  try {
    const [a, b] = await Promise.all([prepareCanonicalGroupSend(owner, { text: 'a' }), prepareCanonicalGroupSend(owner, { text: 'b' })])
    expect(a).toEqual(b)
    await retireCanonicalGroupSend(owner, 'wrong-event')
    expect(await readCanonicalGroupSend(owner)).toEqual(a)
    await retireCanonicalGroupSend(owner, a.params.event_id)
    expect(await readCanonicalGroupSend(owner)).toBeUndefined()
  } finally { uninstall() }
})

it('refuses preparation when the host has no atomic journal', async () => {
  const uninstall = installHostServices({ registerContribution: () => () => {} })
  try {
    await expect(prepareCanonicalGroupSend({ connectionId: 'remote', profile: 'ops', roomId: 'room' }, { text: 'x' })).rejects.toThrow('Plugin host capability unavailable: preparedSubmissions')
  } finally { uninstall() }
})
