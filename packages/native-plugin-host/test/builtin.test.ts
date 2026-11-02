import {expect,it,vi} from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import {PaneVisibilityProvider} from '../src/pane-visibility'
import {queryClient} from '../../plugin-sdk/src/lib/query-client'
import {installHostServices} from '../../plugin-sdk/src/services'
import {createPluginContext} from '../../plugin-sdk/src/plugin-runtime/context'
import {NativeBridge} from '../src/bridge'
import {createNativeServices} from '../src/services'
it('registers and disposes the actual Bots plugin under native services', async () => {
  const bridge=new NativeBridge({postMessage:s=>{const m=JSON.parse(s);if(m.id)queueMicrotask(()=>bridge.receive({type:'plugin-response',id:m.id,error:'synthetic offline'}))}})
  const services=createNativeServices(bridge,localStorage);services.hydrate({connection_id:'a',profile:'p',profiles:['p']})
  const uninstall=installHostServices(services.host); const instance=createPluginContext('hermes-bots',{...services.context,host:services.host})
  try {const plugin=(await import('../../builtin-bots/src/plugin')).default;plugin.register(instance.context);expect(services.registry.areas()).toContain('panes');const pane=services.registry.getArea('panes').find(c=>c.id.endsWith(':pane'))!;services.setPaneVisible(pane.id,true);const view=render(React.createElement(QueryClientProvider,{client:queryClient},React.createElement(PaneVisibilityProvider,{value:true},pane.render!())));expect(view.container.textContent).toBeTruthy();view.unmount();await new Promise(resolve=>setTimeout(resolve,0));instance.dispose();expect(services.registry.areas()).toHaveLength(0)} finally {cleanup();instance.dispose();uninstall();bridge.close()}
}, 20000)

it('cancels the actual Bots deferred routines callback before host uninstall', async () => {
  const bridge=new NativeBridge({postMessage:s=>{const m=JSON.parse(s);if(m.id)queueMicrotask(()=>bridge.receive({type:'plugin-response',id:m.id,error:'synthetic offline'}))}})
  const services=createNativeServices(bridge,localStorage);services.hydrate({connection_id:'a',profile:'p',profiles:['p']})
  const uninstall=installHostServices(services.host);const instance=createPluginContext('hermes-bots',{...services.context,host:services.host})
  const plugin=(await import('../../builtin-bots/src/plugin')).default
  vi.useFakeTimers()
  try { plugin.register(instance.context); instance.dispose(); uninstall(); expect(()=>vi.advanceTimersByTime(0)).not.toThrow() }
  finally { instance.dispose(); uninstall(); bridge.close(); vi.useRealTimers() }
}, 20000)

it('keeps actual Bots activity notices working when native unread hooks are absent', async () => {
  const bridge = new NativeBridge({ postMessage: () => {} })
  const services = createNativeServices(bridge, localStorage)
  services.hydrate({ connection_id: 'a', profile: 'default', profiles: ['default', 'work'] })
  const uninstall = installHostServices(services.host)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(services.host.markSessionUnreadFinished).toBeUndefined()
    const { trackInboundActivity, $activityToasts } = await import('../../builtin-bots/src/roster-actions')
    const bot = { name: 'work', canonical_session: { id: 'work-chat', last_active: 10, preview: 'first' } }
    $activityToasts.set(true)
    trackInboundActivity([bot])
    expect(() => trackInboundActivity([{ ...bot, canonical_session: { ...bot.canonical_session, last_active: 20, preview: 'new message' } }])).not.toThrow()
    expect(services.notices.get().some(notice => notice.message === 'new message')).toBe(true)
  } finally {
    services.disposeNotices()
    uninstall()
    bridge.close()
    warn.mockRestore()
  }
})
