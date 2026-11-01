import React from 'react'
import {render,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {expect,it} from 'vitest'
import {NativeBridge} from '../src/bridge'
import {createNativeServices} from '../src/services'
it('renders real scoped skill/toolset controls and sends the toggle to the fixed owner',async()=>{
  const frames:any[]=[];let bridge:NativeBridge
  bridge=new NativeBridge({postMessage:s=>{const m=JSON.parse(s);frames.push(m);if(m.type!=='plugin-request')return;queueMicrotask(()=>bridge.receive({type:'plugin-response',id:m.id,value:m.payload.method==='PUT'?{ok:true,name:'x',enabled:false}:m.payload.path==='/api/skills'?[{name:'x',description:'Useful',enabled:true,category:'test'}]:[]}))}})
  const services=createNativeServices(bridge,localStorage);services.hydrate({connection_id:'primary',profile:'default'})
  const View=services.host.CapabilitiesView!;const view=render(<View fixedConnection="remote" fixedProfile="ops" />)
  try {const checkbox=await view.findByRole('checkbox');fireEvent.click(checkbox);await waitFor(()=>expect(frames.some(m=>m.payload?.method==='PUT')).toBe(true));const mutation=frames.find(m=>m.payload?.method==='PUT');expect(mutation.payload).toMatchObject({connectionId:'remote',profile:'ops',path:'/api/skills/toggle',body:{name:'x',enabled:false}})} finally {cleanup();services.pool.close();bridge.close()}
})
