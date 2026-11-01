import { afterEach, expect, it, vi } from 'vitest'
import { host } from '../src/host'
import { installHostServices } from '../src/services'
import { pluginSettingsHref } from '../src/settings-link'
import { reasoningEffortLabel } from '../src/lib/reasoning-effort'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined })
it('forwards session and composer operations to the installed authority', async () => {
  const pin = vi.fn()
  const insertText = vi.fn(async () => true)
  dispose = installHostServices({
    registerContribution: () => () => {},
    sessions: { pin, reorder: vi.fn(), reorderPinned: vi.fn(), setColor: vi.fn() },
    composer: { getDraft: async () => null, setDraft: async () => true, insertText, submit: () => true, focus: () => {} }
  })
  host.sessions.pin('durable', false, 2)
  expect(pin).toHaveBeenCalledWith('durable', false, 2)
  await expect(host.composer.insertText('session', 'text', { mode: 'prefix' })).resolves.toBe(true)
  expect(insertText).toHaveBeenCalledWith('session', 'text', { mode: 'prefix' })
  dispose(); dispose = undefined
  expect(() => host.sessions).toThrow('not been installed')
})
it('retains plugin route encoding and reasoning wire labels', () => {
  expect(pluginSettingsHref('a & b', 'one/two')).toBe('/settings?tab=plugins&plugin=a+%26+b&ppage=one%2Ftwo')
  expect(reasoningEffortLabel('ultra', 'max')).toBe('Ultra→Max')
})
