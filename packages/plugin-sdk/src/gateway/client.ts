import {
  type GatewayEvent,
  type GatewayEventName,
  JsonRpcGatewayClient,
  type ServerRequest,
  type ServerRequestHandler
} from '@hermes/shared'
import { CanonicalDesktopProtocol, canonicalProfile, canonicalPromptParams, canonicalSessionKey, openGatewaySocket, recordCanonicalOwner, splitRewindSubmit } from './canonical-protocol'

// Desktop startup fires a burst of read-only data calls (config, profiles,
// model info/options, cron) the moment the backend passes readiness. On a
// profile-heavy or remote install these can each take tens of seconds — e.g.
// /api/profiles runs list_profiles(), which does a recursive skill-tree walk
// per profile — so the 15s default (DEFAULT_FETCH_TIMEOUT_MS in hardening.ts)
// times out a backend that is alive-but-busy, surfacing as a spurious
// "Timed out connecting to Hermes backend" that hangs the UI (#48504).
//
// Give the boot burst a generous per-call timeout instead of raising the
// global default: interactive/runtime calls and the liveness poll (/api/status)
// keep the short default so a genuinely-dead backend is still detected fast.
export const STARTUP_REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = 30_000
// prompt.submit is effectively fire-and-forget: turn completion is signaled by
// stream / message.complete events, NOT by the RPC return. A long turn (MoA
// presets running references + aggregator in series, deep reasoning, large tool
// chains) can legitimately take minutes to ACK, so bounding the ack by the
// generic 30s default surfaces a false "request timed out" toast while the turn
// is still running and will succeed (issue #55024). Match the backend's
// agent-turn ceiling (agent.gateway_timeout = 1800s) so the ack timeout only
// ever fires when the turn itself would have been abandoned server-side.
export const PROMPT_SUBMIT_REQUEST_TIMEOUT_MS = 1_800_000

export const GATEWAY_NOT_CONNECTED_MESSAGE = 'Hermes gateway is not connected'

// Canonical shared prompts (`gateway/session_pending_controls.py`) travel as
// `approval.request` / `clarify.request` EVENTS keyed by `prompt_id` and are
// answered through `approval.respond` / `clarify.respond`. The renderer only
// knows server→client REQUESTS (#110521), so each prompt event is delivered to
// the same `onRequest` registry as a request whose `respond` issues the RPC.
const CANONICAL_PROMPT_EVENTS: Record<string, 'approval' | 'clarify'> = { 'approval.request': 'approval', 'clarify.request': 'clarify' }

const ATTACH_REQUIRED = new Set([
  'prompt.submit',
  'approval.respond',
  'clarify.respond',
  'session.interrupt',
  'prompt.cancel',
  'session.rewind',
  'prompt.steer_queued',
  'prompt.replace_queued'
])

// A branch is a CAS mutation on the PARENT: an un-attached parent (right-click on a sidebar row
// that was never opened) has no cached revision, so attach it first to learn one. Move to project
// (`session_key`) is the same CAS mutation on a sidebar row.
const PARENT_ATTACH_REQUIRED = new Set(['session.branch_stored', 'session.branch_whole', 'session.workspace.move'])

// Canonical-only identity keys. The legacy `hermes serve` contract refuses an unknown key as
// version skew (4000), so they are stripped on a non-canonical dial. `prompt.submit` keeps its
// `submission_id` on purpose: the submit path retries identityless on that exact refusal and
// records the send as legacy-attempted, which a silent strip here would hide. A message-level
// `session.branch` keeps its legacy `count` prefix; only the canonical row boundary is dropped.
const LEGACY_STRIP: Record<string, string[]> = {
  'session.create': ['request_id'],
  'session.branch_stored': ['request_id'],
  'session.branch': ['through_message_id']
}

function legacyParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
  const strip = LEGACY_STRIP[method]

  if (!strip || !strip.some(key => key in params)) { return params }

  return Object.fromEntries(Object.entries(params).filter(([key]) => !strip.includes(key)))
}

// A caller timeout of 0 (or less) means no deadline, as in the shared channel, which arms no timer
// for it. Callers that wait on a way-out offer instead (onboarding.state / onboarding.start) pass 0.
function requestDeadline(timeoutMs: number | undefined): number {
  const budget = timeoutMs ?? DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS

  return budget > 0 ? Date.now() + budget : Number.POSITIVE_INFINITY
}

function remainingRequestBudget(deadline: number, signal?: AbortSignal): number {
  signal?.throwIfAborted()

  if (deadline === Number.POSITIVE_INFINITY) { return 0 }
  const remaining = deadline - Date.now()

  if (remaining <= 0) { throw new Error('Hermes gateway request timed out') }

  return remaining
}

export class HermesGateway extends JsonRpcGatewayClient {
  private canonical = false
  private readonly protocol = new CanonicalDesktopProtocol()
  private readonly promptHandlers = new Set<ServerRequestHandler>()
  // A stored ID can exist in several profile islands (for example after import).
  private readonly deliveredPrompts = new Map<string, { sessionId: string; profile: string }>()
  private readonly sessionProfiles = new Map<string, Set<string>>()
  private readonly profileAliases = new Map<string, string>()
  private readonly replayProfiles = new Map<string, { sessionId: string; profile: string }>()
  private readonly displayProfiles = new Map<string, string>()
  private readonly eventRoutes = new WeakMap<GatewayEvent, string>()
  private readonly reconciledEpochs = new Set<string>()
  // Frames of an ambiguous (session, epoch) parked until its owner probes settle.
  private readonly parkedFrames = new Map<string, Array<() => void>>()
  private connectionGeneration = 0

  override onRequest(handler: ServerRequestHandler): () => void {
    this.promptHandlers.add(handler)
    const off = super.onRequest(handler)

    return () => {
      this.promptHandlers.delete(handler)
      off()
    }
  }

  private deliverCanonicalPrompt(event: { type: string; session_id?: string; profile?: string; payload?: unknown }, replayed: boolean) {
    const kind = CANONICAL_PROMPT_EVENTS[event.type]
    const p = event.payload as Record<string, unknown> | undefined
    const sid = event.session_id

    if (!kind || !p || !sid || typeof p.prompt_id !== 'string') { return }
    const id = p.prompt_id
    const profile = canonicalProfile(event.profile)
    const generation = this.connectionGeneration

    if (this.deliveredPrompts.has(id)) { return }
    this.deliveredPrompts.set(id, { sessionId: sid, profile })
    const params = canonicalPromptParams(kind, sid, p)

    let settled = false

    const request: ServerRequest = {
      id,
      method: kind,
      params,
      replayed,
      respond: result => {
        if (settled || generation !== this.connectionGeneration) { return }
        settled = true

        // A clarify reply without an answer (skip, Stop, cancel) is the empty answer the
        // authority records as skipped; `clarify.respond` refuses a missing field.
        const answer = kind === 'clarify'
          ? { answer: typeof result.answer === 'string' ? result.answer : '' }
          : { choice: result.choice }

        void this.request(`${kind}.respond`, { session_id: sid, profile, request_id: id, ...answer })
          .catch(() => this.recoverCanonicalPrompt(id, sid, profile, generation))
      },
      // A card this window declined (a stopped session) is not delivered: the next authoritative
      // snapshot that still lists the prompt shows it again. Only answered prompts stay deduplicated.
      fail: () => {
        if (settled) { return }
        settled = true

        if (generation === this.connectionGeneration) { this.deliveredPrompts.delete(id) }
      }
    }

    recordCanonicalOwner(request, this.displayProfiles.get(canonicalSessionKey(sid, profile)) ?? profile)

    for (const handler of this.promptHandlers) {
      if (handler(request) !== false) { return }
    }
  }

  private async recoverCanonicalPrompt(id: string, sessionId: string, profile: string, generation: number): Promise<void> {
    if (generation !== this.connectionGeneration || !this.deliveredPrompts.has(id)) { return }
    this.deliveredPrompts.delete(id)

    // A lost reply may have committed. Reopen a card only if the authority's
    // snapshot still lists it; never resend an approval from a cached event.
    try { await this.request('session.resume', { session_id: sessionId, profile }) } catch {
      // A disconnected socket will reconcile its pending prompts on reattach.
    }
  }

  override close(): void {
    this.connectionGeneration++
    this.deliveredPrompts.clear()
    this.sessionProfiles.clear()
    this.profileAliases.clear()
    this.retainReplayOwners()
    this.displayProfiles.clear()
    this.reconciledEpochs.clear()
    this.parkedFrames.clear()
    this.attached.clear()
    super.close()
  }

  // An epoch's owner qualifies the shared client's retained replay cursor, not this socket's
  // attachments: it lives exactly as long as that cursor, so a redial replays to the same owner.
  private retainReplayOwners(): void {
    const cursors = this.getSeqWatermarks()

    for (const [epoch, owner] of this.replayProfiles) {
      if (!(owner.sessionId in cursors)) { this.replayProfiles.delete(epoch) }
    }
  }

  override on<K extends GatewayEventName>(type: K, handler: (event: GatewayEvent<K>) => void): () => void {
    // Named listeners run before wildcard listeners in the shared client.
    // Normalize before either kind sees the prompt, including replay delivery.
    return super.on<K>(type, event => this.deliverNormalized(event, handler as (event: GatewayEvent) => void))
  }

  override onAny(handler: (event: GatewayEvent) => void): () => void {
    return super.onAny(event => this.deliverNormalized(event, handler))
  }

  private deliverNormalized(event: GatewayEvent, handler: (event: GatewayEvent) => void): void {
    const key = JSON.stringify([event.session_id, event.replay_epoch])
    // While an owner probe for this (session, epoch) runs, its frames wait and deliver in order.
    const parked = this.canonical && event.session_id ? this.parkedFrames.get(key) : undefined

    const deliver = () => {
      if (!this.canonical || this.normalizeCanonicalEvent(event)) { handler(event) }
    }

    if (parked) {
      parked.push(deliver)
    } else if (!this.canonical || this.normalizeCanonicalEvent(event)) {
      handler(event)
    } else {
      // The owner probe this frame just started may establish its route; it is the first frame parked.
      this.parkedFrames.get(key)?.push(deliver)
    }
  }


  private rememberSessionProfile(sessionId: string, profile: unknown): void {
    const profiles = this.sessionProfiles.get(sessionId) ?? new Set<string>()
    profiles.add(this.resolveSessionProfile(sessionId, profile))
    this.sessionProfiles.set(sessionId, profiles)
  }

  private resolveSessionProfile(sessionId: string, profile: unknown): string {
    return this.profileAliases.get(canonicalSessionKey(sessionId, profile)) ?? canonicalProfile(profile)
  }

  private snapshotRoute(params: Record<string, unknown>, snapshot: unknown): Record<string, unknown> {
    if (!snapshot || typeof snapshot !== 'object') { return params }
    const data = snapshot as { session_id?: unknown; replay_epoch?: unknown; info?: { profile_name?: unknown; profile_id?: unknown } }
    const sid = data.session_id

    if (typeof sid !== 'string') { return params }
    const previous = canonicalProfile(params.profile)
    const replayOwner = typeof data.replay_epoch === 'string' ? this.replayProfiles.get(data.replay_epoch) : undefined
    const named = data.info?.profile_name

    const profile = typeof named === 'string' && named ? named :
      replayOwner?.sessionId === sid ? replayOwner.profile : previous

    this.profileAliases.set(canonicalSessionKey(sid, previous), profile)

    if (typeof data.info?.profile_id === 'string') {
      this.profileAliases.set(canonicalSessionKey(sid, data.info.profile_id), profile)
    }

    const profiles = this.sessionProfiles.get(sid)
    profiles?.delete(previous)
    this.rememberSessionProfile(sid, profile)

    // The implicit route of a named launch profile and its explicit name are
    // one owner. Store retry identities under that stable name across redials.
    return profile === previous ? params : { ...params, profile }
  }

  private normalizeCanonicalEvent(event: GatewayEvent): boolean {
    if (!event.session_id) { return true }
    const owner = event.replay_epoch ? this.replayProfiles.get(event.replay_epoch) : undefined
    const profiles = this.sessionProfiles.get(event.session_id)

    let profile = owner?.sessionId === event.session_id ? owner.profile : this.eventRoutes.get(event) ??
      (profiles?.size === 1 ? profiles.values().next().value : profiles?.size ? undefined : 'default')

    if (profile === undefined) {
      this.reconcileAmbiguousEvent(event.session_id, event.replay_epoch)

      return false
    }

    profile = this.resolveSessionProfile(event.session_id, profile)
    // The renderer already understands an owner profile tag on shared-socket events.
    this.eventRoutes.set(event, profile)
    event.profile = this.displayProfiles.get(canonicalSessionKey(event.session_id, profile)) ?? profile
    recordCanonicalOwner(event, event.profile)
    this.protocol.event({ ...event, profile })

    return true
  }

  private reconcileAmbiguousEvent(sessionId: string, epoch?: string): void {
    const key = JSON.stringify([sessionId, epoch])

    if (this.reconciledEpochs.has(key)) { return }
    this.reconciledEpochs.add(key)
    this.parkedFrames.set(key, [])
    const generation = this.connectionGeneration

    // A new/unknown replay epoch cannot choose between equal stored IDs. One
    // authoritative snapshot per known owner recovers cards and establishes routes.
    const probes = [...this.sessionProfiles.get(sessionId) ?? []].map(profile =>
      this.request('session.resume', { session_id: sessionId, profile }))

    void Promise.allSettled(probes).then(results => {
      if (generation !== this.connectionGeneration) { return }
      const parked = this.parkedFrames.get(key) ?? []
      this.parkedFrames.delete(key)

      // No owner answered: a later frame probes again instead of being dropped until reconnect.
      if (!results.some(result => result.status === 'fulfilled')) {
        this.reconciledEpochs.delete(key)

        return
      }

      for (const deliver of parked) { deliver() }
    })
  }

  protected override isDesktopLocal(): boolean {
    return this.canonical
  }

  override async connect(wsUrl: string): Promise<void> {
    this.connectionGeneration++
    this.canonical = new URL(wsUrl).searchParams.has('native_dial')
    this.attached.clear()
    this.deliveredPrompts.clear()
    this.sessionProfiles.clear()
    this.profileAliases.clear()
    this.retainReplayOwners()
    this.displayProfiles.clear()
    this.reconciledEpochs.clear()
    this.parkedFrames.clear()

    return super.connect(wsUrl)
  }

  // Sessions attached over THIS socket. An authority subscription is per
  // transport: when routing moves a session to another socket (a profile split,
  // a redial) the new socket must resume before it may submit or respond.
  private attached = new Set<string>()

  private routeCanonicalParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
    if (method === 'session.events.since' && params.profile === undefined && typeof params.replay_epoch === 'string') {
      const owner = this.replayProfiles.get(params.replay_epoch)

      // The shared client's reconnect cursor predates the new socket's
      // attachments. Never route an unknown old cursor to the launch profile.
      if (!owner || owner.sessionId !== params.session_id) { throw new Error('Replay owner unavailable; reopen the session') }
      params = { ...params, profile: owner.profile }
    }

    // Prompt callbacks carry session identity, while sibling sessions share the
    // primary socket. Keep the route learned from their successful attachment.
    const sid = params.session_id ?? params.parent_session_id

    if (typeof sid === 'string' && params.profile !== undefined) {
      params = { ...params, profile: this.resolveSessionProfile(sid, params.profile) }
    }

    const profiles = this.sessionProfiles.get(String(sid ?? ''))

    if (params.profile === undefined && profiles?.size) {
      if (profiles.size !== 1) { throw new Error('Session ID belongs to several profiles; select its owner profile before continuing') }
      const profile = profiles.values().next().value!

      if (profile !== 'default') { params = { ...params, profile } }
    }

    if (typeof sid === 'string' && ['session.resume', 'session.activate'].includes(method)) {
      // Live frames may precede the attachment ACK. Register its explicit route
      // before the await; concurrent equal-ID mounts are reconciled above.
      this.rememberSessionProfile(sid, params.profile)
    }

    return params
  }

  override async request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number, signal?: AbortSignal): Promise<T> {
    if (!this.canonical) { return super.request<T>(method, legacyParams(method, params), timeoutMs, signal) }
    const generation = this.connectionGeneration
    const deadline = requestDeadline(timeoutMs)
    // A truncating submit (edit / regenerate / restore) is the owner's rewind, then the submit.
    const rewind = method === 'prompt.submit' ? splitRewindSubmit(params) : null

    if (rewind) {
      if (rewind.rewind) { await this.request('session.rewind', rewind.rewind, remainingRequestBudget(deadline, signal), signal) }

      return this.request<T>('prompt.submit', rewind.submit, remainingRequestBudget(deadline, signal), signal)
    }

    // A question's owner is immutable even when a second profile attaches an
    // equal stored session ID while the first card remains open.
    const promptOwner = method === 'clarify.lock' ? this.deliveredPrompts.get(String(params.request_id ?? '')) : undefined

    if (promptOwner) {
      const answer = typeof params.answer === 'string' ? params.answer : ''

      return this.request<T>('clarify.respond', { session_id: promptOwner.sessionId, profile: promptOwner.profile, request_id: params.request_id, answer }, timeoutMs, signal)
    }

    params = this.routeCanonicalParams(method, params)

    await this.attachForRequest(method, params, deadline, signal)
    this.requireConnectionGeneration(generation)
    // The attach may have identified the named launch profile behind an
    // implicit route. Its revision and generation are cached under that owner.
    params = this.routeCanonicalParams(method, params)

    // Answered locally only once the owner's route is known: a named launch profile's
    // retained rewind is keyed under its name, which a redial forgets until the attach.
    const local = this.protocol.localAnswer(method, params)

    if (local) { return local as T }

    let prepared = this.protocol.prepare(method, params)
    const wireMethod = this.protocol.wire(method, prepared)

    try {
      let result: T

      try {
        result = await super.request<T>(wireMethod, prepared, remainingRequestBudget(deadline, signal), signal)
      } catch (error) {
        if (!this.protocol.retryableFence(prepared, error)) { throw error }
        // The refusal carried the owner's current fences: one retry at them, never a loop.
        this.protocol.failure(prepared, error)
        this.requireConnectionGeneration(generation)
        prepared = this.protocol.prepare(method, params)
        result = await super.request<T>(wireMethod, prepared, remainingRequestBudget(deadline, signal), signal)
      }

      this.requireConnectionGeneration(generation)

      if (['session.resume', 'session.create', 'session.activate'].includes(method)) {
        prepared = this.snapshotRoute(prepared, result)
      }

      // A settle follow-up (compress -> resume) inherits the caller's deadline and cancellation.
      const followUp = (m: string, p: Record<string, unknown>) => {
        this.requireConnectionGeneration(generation)

        return this.request(m, p, remainingRequestBudget(deadline, signal), signal)
      }

      const settled = await this.protocol.settle(method, prepared, this.protocol.result(method, prepared, result), followUp) as T
      this.requireConnectionGeneration(generation)

      if (method === 'session.resume' || method === 'session.create' || method === 'session.activate') {
        this.adoptAttachedSnapshot(settled as { session_id?: string; prompts?: Array<Record<string, unknown>> }, prepared.profile)
      }

      return settled
    } catch (error) {
      this.protocol.failure(prepared, error)
      throw error
    }
  }

  private requireConnectionGeneration(generation: number): void {
    if (generation !== this.connectionGeneration) { throw new Error('Hermes gateway connection changed; reopen the session') }
  }

  // Resume the session (and, for branch-like methods, its parent) on THIS socket before a
  // method that needs an authority subscription here.
  private async attachForRequest(method: string, params: Record<string, unknown>, deadline: number, signal?: AbortSignal): Promise<void> {
    const sid = typeof params.session_id === 'string' ? params.session_id : null

    const resume = (sessionId: string) => this.request('session.resume', {
      session_id: sessionId, defer_history: true, omit_messages: true,
      ...(params.profile ? { profile: params.profile } : {})
    }, remainingRequestBudget(deadline, signal), signal)

    if (sid && ATTACH_REQUIRED.has(method) && !this.attached.has(canonicalSessionKey(sid, params.profile))) {
      await resume(sid)
    }

    const parent = PARENT_ATTACH_REQUIRED.has(method) ? params.parent_session_id ?? params.session_id ?? params.session_key : null

    if (typeof parent === 'string' && parent && !this.attached.has(canonicalSessionKey(parent, params.profile))) {
      await resume(parent)
    }
  }

  private adoptAttachedSnapshot(settled: { session_id?: string; replay_epoch?: string; info?: { profile_name?: string }; prompts?: Array<Record<string, unknown>> }, profile?: unknown): void {
    // Prompts still open on the authority re-deliver like `open_requests` after a reconnect.
    const sid = settled.session_id

    if (sid) {
      this.attached.add(canonicalSessionKey(sid, profile))
      this.rememberSessionProfile(sid, profile)

      if (settled.info?.profile_name) {
        this.displayProfiles.set(canonicalSessionKey(sid, profile), settled.info.profile_name)
      }

      if (typeof settled.replay_epoch === 'string') {
        this.replayProfiles.set(settled.replay_epoch, { sessionId: sid, profile: canonicalProfile(profile) })
      }
    }

    for (const prompt of (settled.prompts ?? [])) {
      this.deliverCanonicalPrompt({ type: `${prompt.kind}.request`, session_id: sid, profile: canonicalProfile(profile), payload: prompt }, true)
    }
  }

  constructor() {
    super({
      closedErrorMessage: 'Hermes gateway connection closed',
      connectErrorMessage: 'Could not connect to Hermes gateway',
      createRequestId: nextId => nextId,
      notConnectedErrorMessage: GATEWAY_NOT_CONNECTED_MESSAGE,
      // The channel already answered -32603; surface the crash in devtools like the dial-failure sink.
      onRequestHandlerError: (error, request) =>
        console.error(`[gateway] server request handler crashed for ${request.method} (${request.id}):`, error),
      // The channel already answered -32601; note the missing registry in devtools.
      onUnhandledRequest: request =>
        console.warn(`[gateway] Hermes Desktop has no server-request registry for ${request.method} (${request.id})`),
      requestTimeoutMs: DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS,
      socketFactory: openGatewaySocket
    })
    this.onEvent(event => {
      if (!this.canonical) { return }

      if (event.type in CANONICAL_PROMPT_EVENTS) {
        this.deliverCanonicalPrompt({ ...event, profile: this.eventRoutes.get(event) }, false)
      } else if (event.type.endsWith('.settled')) {
        const id = (event.payload as { prompt_id?: unknown } | undefined)?.prompt_id

        if (typeof id === 'string') { this.deliveredPrompts.delete(id) }
      }
    })
  }
}

