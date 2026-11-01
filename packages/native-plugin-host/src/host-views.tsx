/** Native host views use the same capability endpoints as Desktop's
 * apps/desktop/src/app/capabilities and api/{skills,toolsets}.ts (MIT). */
import * as React from 'react'
import { Streamdown } from 'streamdown'
import type { CapabilitiesViewProps, ConnectorsTabProps, MessageTextContentProps, ProfileScope, ToolsetConfigPanelProps } from '../../plugin-sdk/src/services'
import type { SkillInfo, ToolsetInfo } from '../../plugin-sdk/src/compat-host'
import type { NativeBridge, Owner } from './bridge'
import type { createGatewayPool } from './gateway'
export function createHostViews(bridge: NativeBridge, getPool: () => ReturnType<typeof createGatewayPool>) {
  function route(scope?: ProfileScope): Owner {
    const owner=bridge.lease().owner
    if (!scope) return owner
    if (typeof scope==='string') return {...owner,profile:scope}
    return {connection_id:scope.connectionId ?? owner.connection_id,profile:scope.profile ?? owner.profile}
  }
  const api = <T,>(path:string, scope?:ProfileScope, options:Record<string,unknown>={}) => bridge.api<T>(path,options,route(scope))
  const skills = { list:(scope?:ProfileScope)=>api<SkillInfo[]>('/api/skills',scope), setEnabled:(name:string,enabled:boolean,scope?:ProfileScope)=>api<{ok:boolean;name:string;enabled:boolean}>('/api/skills/toggle',scope,{method:'PUT',body:{name,enabled}}) }
  const toolsets = { list:(scope?:ProfileScope)=>api<ToolsetInfo[]>('/api/tools/toolsets',scope), setEnabled:(name:string,enabled:boolean,scope?:ProfileScope)=>api<{ok:boolean;name:string;enabled:boolean}>(`/api/tools/toolsets/${encodeURIComponent(name)}`,scope,{method:'PUT',body:{enabled}}) }
  function MessageTextContent({text,decorateText,media = true}:MessageTextContentProps) { const content=<Streamdown>{text}</Streamdown>; return <>{decorateText ? decorateText(content) : content}{media && /(?:^|\s)MEDIA:/.test(text) && <p>Media attachments are not available in this native view.</p>}</> }
  function CapabilitiesBody({fixedProfile,fixedConnection,...props}:CapabilitiesViewProps) {
    const scope={connectionId:fixedConnection,profile:fixedProfile};const [data,setData]=React.useState<{skills:SkillInfo[];tools:ToolsetInfo[]}|null>(null);const [error,setError]=React.useState('')
    const refresh=React.useCallback(async()=>{try{const [skillRows,toolRows]=await Promise.all([skills.list(scope),toolsets.list(scope)]);setData({skills:skillRows,tools:toolRows});setError('')}catch(e){setError(String(e))}},[fixedConnection,fixedProfile])
    React.useEffect(()=>{void refresh()},[refresh])
    const toggle=async(kind:'skill'|'tool',name:string,enabled:boolean)=>{try{const result=await (kind==='skill'?skills.setEnabled(name,enabled,scope):toolsets.setEnabled(name,enabled,scope));if(!result.ok)throw new Error('Gateway did not accept the change');await refresh()}catch(e){setError(String(e))}}
    return <section {...props}><h2>Capabilities</h2>{error&&<p role="alert">{error}</p>}{!data?<p>Loading capabilities…</p>:<><h3>Skills</h3>{data.skills.map(row=><label key={row.name} className="flex items-center gap-2 py-1"><input type="checkbox" checked={row.enabled} onChange={e=>void toggle('skill',row.name,e.target.checked)}/><span>{row.name} — {row.description}</span></label>)}<h3>Toolsets</h3>{data.tools.map(row=><label key={row.name} className="flex items-center gap-2 py-1"><input type="checkbox" checked={row.enabled} onChange={e=>void toggle('tool',row.name,e.target.checked)}/><span>{row.label || row.name} — {row.description}</span></label>)}</>}</section>
  }
  const CapabilitiesView = Object.assign(CapabilitiesBody,{supportsFixedConnection:true as const})
  function ConnectorsTab({profile}:ConnectorsTabProps) {
    const [items,setItems]=React.useState<any[]|null>(null);const [error,setError]=React.useState('');const owner=route(profile)
    React.useEffect(()=>{let live=true;void getPool().request<any>(owner,'connectors.list',{owner:{type:'account'}}).then(result=>{if(live)setItems(result.connectors ?? [])},e=>{if(live)setError(String(e))});return()=>{live=false}},[owner.connection_id,owner.profile])
    return <section><h3>Connectors</h3>{error&&<p role="alert">{error}</p>}{items ? items.map((item,index)=><p key={item.slug ?? index}>{item.name ?? item.slug}</p>):!error&&<p>Loading connectors…</p>}<p>Connector account management is not available in this native view.</p></section>
  }
  function ToolsetConfigPanel({toolset,profile}:ToolsetConfigPanelProps) {
    const [value,setValue]=React.useState<any>(null),[error,setError]=React.useState('')
    React.useEffect(()=>{let live=true;void api<any>(`/api/tools/toolsets/${encodeURIComponent(toolset)}/config`,profile).then(data=>{if(live)setValue(data)},e=>{if(live)setError(String(e))});return()=>{live=false}},[toolset,JSON.stringify(profile)])
    return <section><h3>{toolset}</h3>{error&&<p role="alert">{error}</p>}{value?.providers?.map((provider:any)=><p key={provider.name}>{provider.name}{provider.is_active?' · active':''}</p>)}{!value&&!error&&<p>Loading toolset configuration…</p>}<p>Provider and credential changes are not available in this native view.</p></section>
  }
  return {skills,toolsets,MessageTextContent,CapabilitiesView,ConnectorsTab,ToolsetConfigPanel}
}
