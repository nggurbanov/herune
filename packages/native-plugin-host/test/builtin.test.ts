import {expect,it,vi} from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import {PaneVisibilityProvider} from '../src/pane-visibility'
import {queryClient} from '../../plugin-sdk/src/lib/query-client'
import {installHostServices} from '../../plugin-sdk/src/services'
import {createPluginContext} from '../../plugin-sdk/src/plugin-runtime/context'
import {NativeBridge} from '../src/bridge'
import {installNativeSockets} from '../src/socket'
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

it('updates actual Bots metadata when the native host has no identity trace', async () => {
  const bridge = new NativeBridge({ postMessage: () => {} })
  const services = createNativeServices(bridge, localStorage)
  services.hydrate({ connection_id: 'a', profile: 'default', profiles: ['default', 'work'] })
  const uninstall = installHostServices(services.host)
  try {
    expect(services.host.traceIdentityChange).toBeUndefined()
    const { $botMeta } = await import('../../builtin-bots/src/data')
    expect(() => $botMeta.set({ work: { title: 'Work' } })).not.toThrow()
    expect($botMeta.get().work.title).toBe('Work')
    $botMeta.set({})
  } finally {
    services.disposeNotices()
    uninstall()
    bridge.close()
  }
})


it('duplicates a source-owned bot through native services without browser-only cleanup', async () => {
  const frames: any[] = []
  let bridge: NativeBridge
  const send = (message: unknown) => window.dispatchEvent(new CustomEvent('hermes-host-message', {detail: message}))
  bridge = new NativeBridge({postMessage: raw => {
    const message = JSON.parse(raw); frames.push(message)
    queueMicrotask(() => {
      if (message.kind === 'plugin-gateway-prepare') bridge.receive({type:'plugin-response', id:message.id, value:{url:'ws://hermes-native-gateway.invalid/r1'}})
      else if (message.kind === 'plugin-socket-open') { bridge.receive({type:'plugin-response', id:message.id, value:{}}); send({type:'plugin-socket', receipt:'r1', event:'open', data:{}}) }
      else if (message.kind === 'plugin-socket-send') {
        bridge.receive({type:'plugin-response', id:message.id, value:{}})
        const request = JSON.parse(message.payload.frame.text)
        const result = request.method === 'profiles.list' ? {profiles:[{name:'work'}]} : {ok:true,name:'work-2'}
        if (request.id != null) send({type:'plugin-socket',receipt:'r1',event:'message',data:{text:JSON.stringify({jsonrpc:'2.0',id:request.id,result})}})
      } else bridge.receive({type:'plugin-response',id:message.id,value:{}})
    })
  }})
  const services = createNativeServices(bridge, localStorage)
  services.hydrate({connection_id:'a',profile:'default',profiles:['default','work']})
  const removeSockets = installNativeSockets(bridge)
  const uninstall = installHostServices(services.host)
  try {
    expect(services.host.dropLeftoverProfilePrefs).toBeUndefined()
    const { duplicateBot } = await import('../../builtin-bots/src/profile-ops')
    const { $botMeta } = await import('../../builtin-bots/src/data')
    $botMeta.set({})
    const bot = {name:'work',connectionId:'a',connectionKind:'remote',sourceScoped:true,targetProfile:'work'}
    await expect(duplicateBot(bot, [bot])).resolves.toBe('work-2')
    const rpc = frames.filter(m => m.kind === 'plugin-socket-send').map(m => JSON.parse(m.payload.frame.text))
    expect(rpc.filter(m => m.method === 'profiles.create')).toHaveLength(1)
    expect(rpc.find(m => m.method === 'profiles.create')?.params).toMatchObject({profile:'work',name:'work-2',clone_from:'work'})
    expect(frames.find(m => m.kind === 'plugin-gateway-prepare')?.payload).toMatchObject({connectionId:'a',profile:'work'})
  } finally {
    services.pool.close()
    services.disposeNotices()
    uninstall()
    removeSockets()
    bridge.close()
  }
}, 15000)
