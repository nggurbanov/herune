

export interface SessionInfo {
  archived?: boolean
  cwd?: null | string
  /** Git branch checked out in {@link cwd} when the session started/resumed.
   *  The sidebar groups main-checkout sessions by this so feature-branch work
   *  doesn't collapse under a single directory-named "main" row. Null for
   *  non-git workspaces and sessions created before branch capture landed. */
  git_branch?: null | string
  /** Git repo root that owns {@link cwd} — the authoritative project key,
   *  resolved server-side at cwd-set (and backfilled for history). The sidebar
   *  groups by this instead of probing git in the GUI. Null for non-git
   *  workspaces and not-yet-backfilled rows. */
  git_repo_root?: null | string
  ended_at: null | number
  id: string
  /** Original root id of a compression chain, when this entry is a projected
   *  continuation tip. Stable across compressions — used as the durable id for
   *  pins so a pinned conversation survives auto-compression. */
  _lineage_root_id?: null | string
  /** Every id on the compression chain (root, intermediates, tip) when this
   *  entry is a projected continuation tip. Intermediates matter: a persisted
   *  tile or route can hold a middle segment's id from when IT was the tip. */
  _lineage_ids?: null | string[]
  /** Provenance of this row when it is a projected continuation tip:
   *  `'compression'` means the conversation was rotated by automatic context
   *  compression and this row continues a sealed earlier segment — it is NOT a
   *  fresh conversation and NOT a user branch (#121148). Surfaced so the
   *  sidebar can label the lineage; undefined against older backends and for
   *  plain rows and branches. */
  continuation_kind?: 'compression'
  input_tokens: number
  /** Spend for the session, straight off the `sessions` row. `actual` is set
   *  when the provider reported a price; `estimated` is our own pricing-table
   *  math. Both are 0 on subscription auth that never quotes a price, which is
   *  why the sidebar only offers a cost sort when some session has spend. */
  actual_cost_usd?: null | number
  estimated_cost_usd?: null | number
  is_active: boolean
  /** Cron run rows only (`source === 'cron'`): the scheduler still OWNS this
   *  never-closed run — its in-flight execution is held by a live process.
   *  Unlike {@link is_active} (a 300s activity window) it stays true through a
   *  long tool call and is false for a zombie whose process died (#88443).
   *  Undefined against older backends and for non-cron rows. */
  scheduler_owned?: boolean
  last_active: number
  message_count: number
  model: null | string
  output_tokens: number
  /** Parent conversation id. Written for genuine /branch forks *and* for
   *  /new / idle / daily resets (durable lineage). Nesting uses
   *  {@link _branched_from} vs {@link _reset_from}, not this field alone. */
  parent_session_id?: null | string
  /** Predecessor of a /new or idle/daily reset. Not a fork — the sidebar
   *  renders these as siblings of the previous topic. */
  _reset_from?: null | string
  /** Parent of a genuine /branch fork. The sidebar nests only these. */
  _branched_from?: null | string
  /** True for an internal delegate_task child. Exact-id endpoints return these
   *  rows for direct watch/resume, but ordinary session lists must not surface
   *  them. Undefined against backends predating the projection. */
  is_internal_child?: boolean
  /** Durable server-side pin flag (`sessions.pinned`). The list endpoints
   *  back-fill pinned conversations past their LIMIT, so a pinned row is
   *  always present in a page — which makes this authoritative for the
   *  sidebar's Pinned section and lets a second app adopt pins made
   *  elsewhere. Undefined against a backend predating the flag; treat that as
   *  "no opinion" and leave the local pin set alone. */
  pinned?: boolean
  /** Server-side hide flag (`sessions.hidden`). Hidden rows (canonical Bot
   *  Chats, group-chat plumbing) never reach a sidebar page, so a row
   *  carrying `hidden: true` only exists in the local list through an
   *  optimistic insert or a keep-list carry — the merge must not let it
   *  survive a refresh (#113273). Undefined against older backends; treat
   *  as visible. */
  hidden?: boolean
  /** Derived read state (backend watermark: `last_read_at` vs `last_active`,
   *  see `SessionDB.session_unread`). True when the conversation was
   *  explicitly marked unread or a response arrived after it was last read.
   *  Undefined against a backend predating the flag; treat as read. */
  unread?: boolean
  preview: null | string
  source: null | string
  started_at: number
  title: null | string
  tool_call_count: number
  /** Origin platform when this session was handed off from a messaging
   *  platform (e.g. a Telegram thread continued in the desktop app). The live
   *  {@link source} becomes local (tui/desktop) after a handoff, so the origin
   *  is preserved here to surface the platform badge on the row. */
  handoff_platform?: null | string
  /** Handoff lifecycle: 'pending' | 'in_progress' | 'completed' | 'failed'. */
  handoff_state?: null | string
  handoff_error?: null | string
  /** Owning profile name, set by the cross-profile aggregator
   *  (`/api/profiles/sessions`). Absent on legacy single-profile responses,
   *  which the UI treats as the default profile. */
  profile?: string
  /** True when {@link profile} is the default profile. */
  is_default_profile?: boolean
  /** Registry connection that owns this row when it came from a CONNECTED
   *  non-primary gateway (Electron's unified-list splice, #88880). Absent for
   *  rows served by the primary/local backend. Opens must route through the
   *  connection-scoped gateway (`ensureGatewayAgent`) when present. */
  connection_id?: string
}