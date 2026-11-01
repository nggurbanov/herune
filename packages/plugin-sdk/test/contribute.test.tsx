// @vitest-environment jsdom
import React, { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Button, Contribute, installHostServices, type Contribution } from '../src/index'

afterEach(cleanup)
it('projects live React state into a host contribution and disposes on unmount', () => {
  let current: Contribution | undefined
  let removed = 0
  const uninstall = installHostServices({ registerContribution(c) { current = c; return () => { current = undefined; removed++ } } })
  function Plugin() {
    const [count, setCount] = useState(0)
    return <><Button onClick={() => setCount(count + 1)}>increment</Button><Contribute area="titleBar.left" id="fixture:count"><span>count {count}</span></Contribute></>
  }
  const plugin = render(<Plugin />)
  expect(current?.id).toBe('fixture:count')
  const slot = render(<>{current!.render!()}</>)
  expect(screen.getByText('count 0')).toBeTruthy()
  fireEvent.click(screen.getByText('increment'))
  expect(screen.getByText('count 1')).toBeTruthy()
  act(() => plugin.unmount())
  expect(removed).toBe(1)
  expect(current).toBeUndefined()
  slot.unmount()
  uninstall()
})
it('fails visibly when no host services are installed', () => {
  expect(() => render(<Contribute area="x" id="x">x</Contribute>)).toThrow('Plugin host services have not been installed')
})
