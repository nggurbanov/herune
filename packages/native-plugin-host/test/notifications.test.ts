import { expect, it, vi } from 'vitest'
import { NativeBridge } from '../src/bridge'
import { createNotifications } from '../src/notifications'
it('attributes a native notification and retires callbacks on disposal or owner change', async () => {
  const frames: any[] = []; const bridge = new NativeBridge({postMessage: s => frames.push(JSON.parse(s))}); bridge.setOwner({connection_id:'a',profile:'p'})
  const notifications = createNotifications(bridge); const callback = vi.fn(); let dispose = () => {}
  notifications.send('plugin', {title:'Hi', actions:[{id:'go',label:'Open',onAction:callback}],activate:'hermes://open/bots'}, fn => { dispose=fn; return fn })
  const sent=frames[0]; expect(sent.payload.tag).toBe('plugin'); expect(sent.payload.actions[0].text).toBe('Open'); expect(sent.payload.activate).toBe('/bots')
  bridge.receive({type:'plugin-response', id:sent.id, value:true}); await Promise.resolve()
  expect(notifications.receive({type:'plugin-notify-activate',notifyId:sent.payload.notifyId,pluginId:'plugin',actionId:'go',activate:'/bots'})).toBe('/bots'); expect(callback).toHaveBeenCalledOnce()
  notifications.send('plugin', {title:'Hi', onActivate:callback}, fn => { dispose=fn; return fn }); const second=frames[1]; dispose()
  expect(notifications.receive({type:'plugin-notify-activate',notifyId:second.payload.notifyId,pluginId:'plugin'})).toBeNull(); expect(callback).toHaveBeenCalledOnce()
  bridge.receive({type:'plugin-response',id:second.id,value:true}); bridge.close()
})
