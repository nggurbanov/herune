import { atom } from 'nanostores'
import { useStore } from '@nanostores/react'
import type { PluginHostServices } from '../../plugin-sdk/src/services'
import type { NotificationInput } from '../../plugin-sdk/src/host-types'
import type { RuntimeContextServices } from '../../plugin-sdk/src/plugin-runtime'
import { NativeBridge } from './bridge'
import { createRegistry } from './registry'
import { createStorage, preparedSubmissions } from './storage'
import { pluginSocket } from './plugin-socket'
import { createNotifications } from './notifications'
import { createI18n } from './i18n/service'
import { createDecisions } from './decisions'
import { usePaneVisible } from './pane-visibility'
import { createGatewayPool } from './gateway'
import { makeSessionStatusDot } from './session-status'
import { createHostViews } from './host-views'

/** Native owner operations use the manager's existing IPC request protocol. */
export function createNativeServices(bridge: NativeBridge, storage: Storage) {
  const registry = createRegistry()
  const notifications = createNotifications(bridge)
  const i18n = createI18n()
  const storagePort = createStorage(bridge, storage)
  const decisions = createDecisions(storagePort)
  const paneStates = new Map<string, ReturnType<typeof atom<boolean>>>()
  const requestedPane = atom<string | null>(null)
  const pane = (id: string) => { let value = paneStates.get(id); if (!value) { value = atom(false); paneStates.set(id, value) }; return value }
  const listeners = new Map<string, Set<(event: any) => void>>()
  const cursors = new Map<string, {epoch:string;seq:number}>()
  const windowListeners = new Set<(state: {isVisible?: boolean}) => void>()
  let workspaceCommitted = ''
  let workspaceGeneration = 0
  let workspaceBusy = false
  let workspacePending: Promise<void> = Promise.resolve()
  const workspaceLabels = new Map<string, string>()
  const notices = atom<Array<NotificationInput & {id:string}>>([])
  const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const dismissNotice = (id:string) => { const notice=notices.get().find(n=>n.id===id); const timer=noticeTimers.get(id); if (timer) clearTimeout(timer); noticeTimers.delete(id); notices.set(notices.get().filter(n=>n.id!==id)); notice?.onDismiss?.() }
  const addNotice = (input:NotificationInput) => { const id=input.id ?? crypto.randomUUID(); const old=noticeTimers.get(id);if(old)clearTimeout(old); notices.set([...notices.get().filter(n=>n.id!==id),{...input,id}]); if(!input.persistent && input.durationMs !== 0) noticeTimers.set(id,setTimeout(()=>dismissNotice(id),input.durationMs ?? 6000)); return id }
  const activationEpoch = atom(0)
  let pool = createGatewayPool(bridge, event => feedEvent(event), value => setGatewayState(value))
  const state = {
    activeSessionId: atom<string | null>(null), awaitingResponse: atom(false), busy: atom(false), busyBySession: atom<Record<string, boolean>>({}),
    connectionId: atom<string | null>(null), cwd: atom(''), focusedSessionId: atom<string | null>(null),
    focusedSessionOwner: atom<{connectionId: string; profile: string} | null>(null), focusedSessionProfile: atom(''),
    focusedStoredSessionId: atom<string | null>(null), focusedUsage: atom(null), viewport: atom({width: window.innerWidth, height: window.innerHeight, narrow: window.innerWidth < 768}),
    gateway: atom('closed'), model: atom(''), profile: atom('')
  }
  const views = createHostViews(bridge,()=>pool)
  const profiles = atom<string[]>([])
  const roster = async () => bridge.ask<any>('registry-roster', {}, 60000)
  const routes = async () => { const data = await roster(); return data.connections.filter((source: any) => !source.error).flatMap((source: any) => source.profiles.map((row: any) => ({ connectionId: source.id, profile: row.name, targetProfile: row.name, mode: source.mode, ...(source.id === data.primary ? { primary: true } : {}) }))) }

  const host: PluginHostServices = {
    haptic: () => { if (typeof navigator.vibrate === 'function') navigator.vibrate(8) },
    ackStoredSessionId(id) { if (id) addNotice({message:'Unread acknowledgement is unavailable for this native plugin view',kind:'warning'}) },
    guestFrameShellUrl: () => null,
    ...views,
    registerContribution: registry.register, state, SessionStatusDot: makeSessionStatusDot(state), usePaneVisible,
    notify: addNotice,
    notifyError(error, fallback, options) { return addNotice({id:options?.id,action:options?.action,message:fallback,detail:String(error),kind:'error'}) }, gatewayActivationEpoch: () => activationEpoch.get(), useGatewayActivationEpoch: () => useStore(activationEpoch), pluginDecisions: decisions,
    paneVisibility: pane, revealPane: id => requestedPane.set(id), undismissPane: id => requestedPane.set(id),
    onWindowStateChanged(listener) { windowListeners.add(listener); return () => { windowListeners.delete(listener) } }, useI18n: i18n.useI18n, usePluginI18n: i18n.usePluginI18n, translateNow: i18n.translateNow,
    profileRequests: {
      requestProfile: (profile, method, params, timeout) => pool.request({ connection_id: bridge.lease().owner.connection_id, profile }, method, params, timeout),
      requestAgent: (connectionId, profile, method, params, timeout) => pool.request({ connection_id: connectionId, profile }, method, params, timeout),
      profileNames: () => profiles.get(), getProfileRoutes: routes,
      getAgentRoster: async () => { const data = await roster(); return { sources: data.connections.map((source: any) => ({ kind: source.kind })) } }
    },
    profileRoutes: routes,
    agents: async () => { const data = await roster(); return {
      primaryConnectionId: data.primary,
      agents: data.connections.filter((s: any) => !s.error).flatMap((s: any) => s.profiles.map((p: any) => ({ connectionId: s.id, connectionKind: s.kind, connectionLabel: s.label, profile: p.name, targetProfile: p.name, handle: p.name === 'default' ? 'hermes' : p.name }))),
      sources: data.connections.map((s: any) => ({ connectionId: s.id, label: s.label, kind: s.kind, reachable: s.attached === true, ...(s.error ? { error: s.error } : {}) }))
    } },
    connections: async () => { const data = await bridge.ask<any>('registry-metadata'); return data.connections.map(({attached, ...s}: any) => ({...s, primary: s.id === data.primary})) },
    request: (method, params, timeout) => pool.request(bridge.lease().owner, method, params, timeout),
    getGateway: () => pool.getPrimary(),
    retainProfile: async route => pool.retain(typeof route === 'string' ? {connection_id:bridge.lease().owner.connection_id,profile:route} : {connection_id:route.connectionId,profile:route.profile}),
    retainProfileSocket: route => pool.retainSocket(typeof route === 'string' ? {connection_id:bridge.lease().owner.connection_id,profile:route} : {connection_id:route.connectionId,profile:route.profile}),
    preparedSubmissions: preparedSubmissions(bridge),
    activeConnectionId: () => bridge.lease().owner.connection_id,
    ensureAgent: async (connectionId, profile) => { const lease=bridge.lease(); const selected=connectionId ?? lease.owner.connection_id; await bridge.ask('ensure-agent',{connectionId:selected,profile,clientOwner:lease.owner},60000); lease.assert(); await bridge.ask('adopt-sdk-route',{connectionId:selected,profile,clientOwner:lease.owner},60000); lease.assert() },
    writeClipboardText: async text => { await bridge.ask('clipboard', { text }) },
    openSession: async (storedSessionId, options = {}) => { const lease=bridge.lease(); await workspacePending; lease.assert(); const title = options.workspaceOwnerKey ? workspaceLabels.get(options.workspaceOwnerKey) : undefined; await bridge.ask('open-session', { stored_session_id: storedSessionId, clientOwner:lease.owner, options: {...options, tabTitle: options.tabTitle ?? title} }, options.hydrationTimeoutMs ?? 60000) },
    setWorkspaceOwnerLabel: (ownerKey,label) => { workspaceLabels.set(ownerKey,label) },
    setWorkspaceScope(mode, ownerKey = null, target = null) { return !workspaceBusy && JSON.stringify({mode,ownerKey,target}) === workspaceCommitted },
    async setWorkspaceScopeAsync(mode, ownerKey = null, target = null) {
      const payload = structuredClone({mode,ownerKey,target}); const serialized = JSON.stringify(payload)
      if (!workspaceBusy && serialized === workspaceCommitted) return true
      const lease = bridge.lease()
      workspaceBusy = true; const operation = ++workspaceGeneration
      workspacePending = workspacePending.catch(() => {}).then(async () => { lease.assert(); const accepted = await bridge.ask<boolean>('workspace-scope',{...payload,clientOwner:lease.owner},60000); lease.assert(); if (accepted !== true) throw new Error('Native workspace update was not accepted'); workspaceCommitted=serialized }).finally(() => { if (workspaceGeneration === operation) workspaceBusy=false })
      await workspacePending
      return true
    },
    newChat: (profile, options = {}) => { const lease=bridge.lease(); void workspacePending.then(() => { lease.assert(); return bridge.ask('new-chat', { profile, options, clientOwner:lease.owner }, 60000) }).catch(error => bridge.emit({ type: 'plugin-error', message: String(error) })) },
    onEvent(type, listener) { const lease = bridge.lease(); const scoped = (event: any) => { try { lease.assert() } catch { return }; listener(event) }; const set = listeners.get(type) ?? new Set(); listeners.set(type, set); set.add(scoped); return () => { set.delete(scoped); if (!set.size) listeners.delete(type) } }
  }
  const context: Omit<RuntimeContextServices, 'host'> = {
    ...storagePort,
    createDoors(id, _capabilities, track) {
      const unavailable = (name: string): never => { throw new Error(`Native plugin capability unavailable: ${name}`) }
      const invoke = async (kind: string, payload: object) => { const result = await bridge.ask<{ok?: boolean}>(kind, { ...payload, pluginId: id }); return result?.ok === true }
      const file = <T extends object>(op: string, folder: string, path = '', extra: object = {}) => bridge.ask<import('../../plugin-sdk/src/plugin-contract').PluginFilesResult<T>>('plugin-data-file', { pluginId: id, op, folder, path, ...extra })
      return {
        rest: (path, options = {}) => {
          if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('\\') || path.includes('#')) throw new Error('Invalid plugin REST path')
          return bridge.api(`/api/plugins/${encodeURIComponent(id)}${path}`, { ...options })
        },
        socket: (path, callback) => pluginSocket(bridge, id, path, callback),
        os: {
          notify: input => notifications.send(id, input, track),
          openExternal: url => invoke('open-external', { url }), revealPath: path => invoke('reveal-path', { path }),
          writeClipboard: text => invoke('clipboard', { text }),
          pickSavePath: options => bridge.ask('select-save-path', options, 600000),
          pickOpenPath: async options => { const paths = await bridge.ask<string[] | null>('select-paths', options, 600000); return paths?.[0] ?? null }
        },
        pet: { visible: atom(false), say: () => unavailable('pet.say'), clear: () => unavailable('pet.clear') },
        runAction: () => ({ ok: false, reason: 'unavailable', error: 'Native action dispatch is unavailable' }), listActions: () => [],
        preview: { isAvailable: () => false, executeJavaScript: async () => unavailable('preview.executeJavaScript') },
        files: {
          dataFolder: 'data', requestFolder: async () => unavailable('files.requestFolder'), folders: async () => unavailable('files.folders'), release: async () => unavailable('files.release'),
          list: (folder, path) => file('list', folder, path), stat: (folder, path) => file('stat', folder, path), readText: (folder, path) => file('readText', folder, path), readDataUrl: async () => unavailable('files.readDataUrl'), writeText: (folder, path, text, options) => file('writeText', folder, path, { text, exclusive: options?.exclusive ?? false }), rename: async () => unavailable('files.rename'), trash: async () => unavailable('files.trash')
        }, i18n: i18n.plugin(id)
      }
    },
    onDisposeError: error => bridge.emit({ type: 'plugin-error', message: String(error) })
  }
  const setGatewayState = (value: string) => { if (state.gateway.get() !== value) { state.gateway.set(value); if (value === 'open') activationEpoch.set(activationEpoch.get()+1) } }
  const feedEvent = (event: any) => {
    bridge.lease(); if (typeof event.connectionId !== 'string' || !event.connectionId || typeof event.profile !== 'string' || !event.profile) return
    if (typeof event.session_id === 'string' && typeof event.seq === 'number' && Number.isFinite(event.seq)) {
      const key=JSON.stringify([event.connectionId,event.profile,event.session_id]), epoch=typeof event.replay_epoch === 'string' ? event.replay_epoch : '', previous=cursors.get(key)
      if (previous && previous.epoch===epoch && previous.seq>=event.seq) return
      cursors.delete(key);cursors.set(key,{epoch,seq:event.seq});if(cursors.size>256)cursors.delete(cursors.keys().next().value!)
    }
    for (const listener of [...(listeners.get(event.type) ?? []), ...(listeners.get('*') ?? [])]) listener(event)
  }
  return { host, context, registry, notifications, notices, dismissNotice, disposeNotices() { for(const timer of noticeTimers.values()) clearTimeout(timer); noticeTimers.clear() }, decisions, requestedPane, get pool() { return pool }, setGatewayState, updateViewport() { state.viewport.set({width:window.innerWidth,height:window.innerHeight,narrow:window.innerWidth<768}) }, setPaneVisible(id: string, visible: boolean) { pane(id).set(visible) }, feedWindowState(visible: boolean) { for (const listener of windowListeners) listener({isVisible: visible}) }, hydrate(snapshot: any) {
    const changed = state.profile.get() !== snapshot.profile || state.connectionId.get() !== snapshot.connection_id
    bridge.setOwner(snapshot)
    if (changed) { pool.close(); pool=createGatewayPool(bridge, event => feedEvent(event), value => setGatewayState(value)); state.gateway.set('closed'); activationEpoch.set(activationEpoch.get()+1); workspaceCommitted = ''; workspaceGeneration++; workspaceBusy=false }
    state.profile.set(snapshot.profile); state.connectionId.set(snapshot.connection_id); state.cwd.set(snapshot.cwd ?? ''); state.model.set(snapshot.model ?? '')
    state.activeSessionId.set(snapshot.runtime_session ?? null); state.focusedSessionId.set(snapshot.runtime_session ?? null)
    state.focusedStoredSessionId.set(snapshot.session ?? null); state.focusedSessionProfile.set(snapshot.profile)
    state.focusedSessionOwner.set({connectionId: snapshot.connection_id, profile: snapshot.profile}); state.busy.set(Boolean(snapshot.busy)); state.busyBySession.set(snapshot.session && snapshot.busy ? {[snapshot.session]:true} : {})
    profiles.set((snapshot.profiles ?? []).map((p: any) => typeof p === 'string' ? p : p.name).filter(Boolean))
    return changed
  }, feedEvent }
}
