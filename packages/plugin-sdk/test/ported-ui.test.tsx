// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { $accentOverride, setAccentOverride, installHostServices, PanelAction, PanelHeader, SandboxedFrame } from '../src/index'

afterEach(() => { cleanup(); setAccentOverride(null) })
it('renders panel actions and invokes their callbacks', () => {
  const action = vi.fn()
  render(<PanelHeader title="Bots" actions={<PanelAction icon="add" onClick={action}>Create</PanelAction>} />)
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(action).toHaveBeenCalledOnce()
})
it('keeps the frame sandbox constrained and rejects unsafe sources', () => {
  const uninstall = installHostServices({ registerContribution: () => () => {}, guestFrameShellUrl: () => null })
  const view = render(<SandboxedFrame src="https://example.test" title="Preview" sandbox="ALLOW-SAME-ORIGIN allow-forms" />)
  expect(screen.getByTitle('Preview').getAttribute('sandbox')).toBe('allow-forms')
  view.rerender(<SandboxedFrame src="javascript:alert(1)" title="Preview" />)
  expect(screen.queryByTitle('Preview')).toBeNull()
  uninstall()
})
it('notifies accent subscribers, ignores invalid colors, and clears', () => {
  const listener = vi.fn()
  const stop = $accentOverride.subscribe(listener)
  setAccentOverride('#abcdef')
  setAccentOverride('invalid')
  expect($accentOverride.get()).toBe('#abcdef')
  setAccentOverride(null)
  expect($accentOverride.get()).toBeNull()
  expect(listener).toHaveBeenCalledTimes(3)
  stop()
})
