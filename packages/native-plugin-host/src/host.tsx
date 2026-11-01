/** Native WebView entry based on apps/rune/src/plugin_host/web/host.tsx at
 * 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT). */
import './styles.css'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router'
import { Button, TooltipProvider } from '@hermes/plugin-sdk'
import { installHostServices } from '../../plugin-sdk/src/services'
import { createInstalledPluginRuntime } from '../../plugin-sdk/src/plugin-runtime/installed'
import { queryClient } from '../../plugin-sdk/src/lib/query-client'
import { NativeBridge } from './bridge'
import { installNativeSockets } from './socket'
import { createNativeServices } from './services'
import { createInventory } from './inventory'
import { createStorage } from './storage'
import { PaneVisibilityProvider } from './pane-visibility'
import { createDiscovery } from './discovery'

declare global { interface Window { ipc: {postMessage(value: string): void}; __HERMES_NATIVE_BOTS_PLUGIN__?: unknown } }
const bridge = new NativeBridge(window.ipc)
const removeSockets = installNativeSockets(bridge)
const services = createNativeServices(bridge, localStorage)
const uninstall = installHostServices(services.host)
const runtime = createInstalledPluginRuntime(services.context)
const inventory = createInventory(runtime, createStorage(bridge, localStorage), services.decisions)
const discovery = createDiscovery(bridge, inventory)
let generation = 0
let selectedOwner = ''
const activeId = atom<string | null>(null)
let lastLoad: {source:string;origin:string} | null = null
let rendered = false
const suspended = new Set<string>()

class ContributionBoundary extends React.Component<{id:string;children:React.ReactNode},{error:string|null}> {
  state = {error:null as string|null}
  static getDerivedStateFromError(error: Error) { return {error:error.message} }
  componentDidCatch(error: Error) { bridge.emit({type:'plugin-error',message:`${this.props.id}: ${error.message}`}) }
  render() { return this.state.error ? <p role="alert">{this.props.id}: {this.state.error}</p> : this.props.children }
}
function Contribution({render}: {render: () => React.ReactNode}) { return React.createElement(render) }
function App() {
  useStore(services.registry.version)
  const active = useStore(activeId)
  const records = useStore(inventory.records), notices = useStore(services.notices), requested = useStore(services.requestedPane)
  const [area,setArea] = React.useState('')
  const areas = services.registry.areas().filter(name => services.registry.getArea(name).some(c=>c.render))
  const selected = areas.includes(area) ? area : areas[0]
  const contributions = selected ? services.registry.getArea(selected).filter(c=>c.render) : []
  React.useEffect(() => { const panes = services.registry.getArea('panes'); for (const c of panes) { try { services.setPaneVisible(c.id, selected === 'panes') } catch(error) { report(error) } }; return () => { for (const c of panes) { try { services.setPaneVisible(c.id, false) } catch(error) { report(error) } } } }, [selected])
  React.useEffect(() => { if (requested) setArea('panes') }, [requested])
  React.useEffect(() => { if (!rendered && contributions.length) { rendered=true; requestAnimationFrame(()=>bridge.emit({type:'plugin-rendered',id:activeId.get(),areas,text:document.getElementById('plugin-content')?.textContent?.slice(0,500)})) } }, [contributions.length])
  return <main className="h-screen flex flex-col bg-background text-foreground"><header className="flex items-center gap-3 border-b px-5 py-3"><strong>{active ? records[active]?.name ?? active : 'Desktop plugins'}</strong><select aria-label="Plugin surface" value={selected ?? ''} onChange={e=>setArea(e.target.value)}>{areas.map(name=><option key={name} value={name}>{name}</option>)}</select></header><div className="flex min-h-0 grow"><aside className="w-64 shrink-0 overflow-auto border-r p-4" aria-label="Desktop plugins">{Object.values(records).map(record=><div key={record.id} className="mb-4"><strong>{record.name}</strong><p className="text-xs text-muted-foreground">{record.description || record.kind}</p><Button variant="ghost" size="sm" disabled={record.status === 'activating' || record.id.includes(':disk-shadowed:')} onClick={()=>void setEnabled(record.id,record.status !== 'loaded').catch(report)}>{record.status === 'loaded' ? 'Disable' : 'Enable'}</Button>{record.error && <p role="alert">{record.error}</p>}</div>)}</aside><section id="plugin-content" className="grow overflow-auto p-5"><PaneVisibilityProvider value={true}>{contributions.map(c=><ContributionBoundary key={`${c.source}:${c.id}`} id={c.id}><Contribution render={c.render!}/></ContributionBoundary>)}</PaneVisibilityProvider>{notices.map(n=><div role="alert" key={n.id}><span>{n.message} {n.detail}</span>{n.action && <Button onClick={()=>{n.action?.onClick();services.dismissNotice(n.id)}}>{n.action.label}</Button>}{n.secondaryAction && <Button onClick={()=>{n.secondaryAction?.onClick();services.dismissNotice(n.id)}}>{n.secondaryAction.label}</Button>}<Button variant="ghost" onClick={()=>services.dismissNotice(n.id)}>Dismiss</Button></div>)}</section></div></main>
}
async function setEnabled(id: string, enabled: boolean) { if (!enabled && id === 'hermes-bots') await services.host.setWorkspaceScopeAsync!('sessions'); await inventory.setEnabled(id, enabled) }
function report(error: unknown) { bridge.emit({type:'plugin-error',message:String(error instanceof Error ? error.message : error)}) }
async function load(message: any) {
  const intent = ++generation
  lastLoad = {source:message.source,origin:message.origin}
  const ownerKey = `${message.owner?.connection_id}\0${message.owner?.profile}`
  if (selectedOwner && selectedOwner !== ownerKey) throw new Error('Plugin owner changed; reopen the plugin host')
  selectedOwner = ownerKey; services.hydrate(message.owner)
  await services.pool.connectPrimary({connection_id:message.owner.connection_id,profile:message.owner.profile})
  if (intent !== generation) return
  let source = message.source as string
  if (!source.trim()) { const plugin=(await import('../../builtin-bots/src/plugin')).default; window.__HERMES_NATIVE_BOTS_PLUGIN__=plugin; await inventory.load('export default window.__HERMES_NATIVE_BOTS_PLUGIN__','bundled-hermes-bots','bundled'); await discovery.prepare(); discovery.watch(); if (intent !== generation) return; activeId.set(null); bridge.emit({type:'plugin-loaded',id:'installed-desktop-plugins'}); return }
  const builtin = source === 'builtin:hermes-bots'
  if (builtin) { const plugin = (await import('../../builtin-bots/src/plugin')).default; window.__HERMES_NATIVE_BOTS_PLUGIN__=plugin; source='export default window.__HERMES_NATIVE_BOTS_PLUGIN__' }
  const id = await inventory.load(source, message.origin ?? 'native', builtin ? 'bundled' : 'disk', message.origin)
  if (intent !== generation) { inventory.dispose(); return }
  activeId.set(id); bridge.emit({type:'plugin-loaded',id})
}
const root = createRoot(document.getElementById('root')!)
root.render(<HashRouter><QueryClientProvider client={queryClient}><TooltipProvider><App /></TooltipProvider></QueryClientProvider></HashRouter>)
window.addEventListener('hermes-host-message', ((event: CustomEvent) => {
  const message=event.detail
  bridge.receive(message)
  if (message.type==='plugin-load') void load(message).catch(report)
  else if (message.type==='plugin-state') { try { const ownerKey=`${message.owner.connection_id}\0${message.owner.profile}`; const changing=Boolean(selectedOwner && selectedOwner!==ownerKey); if (changing) inventory.suspend().forEach(id=>suspended.add(id)); const changed=services.hydrate(message.owner); if (changing && changed) { selectedOwner=ownerKey; const intent=++generation; void services.pool.connectPrimary({connection_id:message.owner.connection_id,profile:message.owner.profile}).then(async()=>{if(intent===generation) { const ids=[...suspended]; if(ids.length) await inventory.resume(ids); else if(lastLoad) await load({...lastLoad,owner:message.owner}); if(intent===generation) suspended.clear() }}).catch(report) } } catch(error) { report(error) } }
  else if (message.type==='plugin-window-state') services.feedWindowState(message.visible === true)
  else if (message.type==='gateway-event') services.feedEvent(message.event)
  else if (message.type==='plugin-server-request') bridge.emit({type:'plugin-server-response',response:{token:message.request?.token,error:{code:-32601,message:'The observer socket has no prompt UI'}}})
  else if (message.type==='plugin-notify-activate' || message.type==='plugin-notify-closed') { const path=services.notifications.receive(message); if (path) window.location.hash=path }
  else if (message.type==='close') { generation++; discovery.dispose(); inventory.dispose(); root.unmount(); services.notifications.clear(); services.disposeNotices(); services.pool.close(); removeSockets(); uninstall(); bridge.close() }
}) as EventListener)
window.addEventListener('resize', services.updateViewport)
window.addEventListener('hashchange',()=>bridge.emit({type:'plugin-navigate',path:window.location.hash.replace(/^#/,'')}))
bridge.emit({type:'plugin-bootstrap-ready'})
