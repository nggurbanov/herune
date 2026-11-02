# Native chat migration

The native transcript uses real Rune/OpenCode Markdown and controls. Hermes owns
connection/profile/session identity and canonical gateway mutation semantics.
This is a working migration increment; complete chat parity remains in progress.

## Implemented

- Stored display rows preserve complete server payloads and durable row IDs.
  Native projection renders ordered text, Markdown/code/tables, readable thought
  disclosures, tool calls with arguments/results, image parts and file actions.
  Tool results join by tool-call identity; opaque provider replay carriers are
  not rendered as thoughts. Folded tool results advance the durable branch
  boundary through their actual source row.
- Copy, quote into the captured conversation's draft, TTS/read aloud, inline user
  edit, retry, restore to draft, and branch from a saved boundary. File/process
  actions use the existing owner-checked Files/Terminal entry points. Native
  image previews read authenticated agent media/proxy endpoints, retain owner
  keys, and decode through Rune ImageCache with bounded source sizes.
- Canonical edit/retry/restore explicitly confirm removal of the selected turn
  and later turns. The retained prepared-send journal records an exact rewind
  mutation before I/O. Its durable target is a server row ID. The following
  prompt retains the same submission identity on explicit retry. Restore-only
  emits no prompt. A typed fence refusal requires fresh user intent; an unknown
  outcome reuses the original mutation UUID and CAS fences.
- Branch persists its exact mutation before I/O, keeps unknown outcomes for
  explicit retry, and writes child receipts/definite-refusal tombstones.
  Startup recovery reads only the selected connection/profile/stored-session's
  intents and receipts. It never replays an action automatically. Profile and
  connection changes are guarded while a mutation remains unresolved.
- Load earlier history uses retained scoped workers. Latest-order pagination can
  overlap both sides of the cached tail: shared durable row IDs place new rows
  before/within/after it. Tail refresh retains backfilled prefixes only with a
  shared anchor and unchanged authority; authoritative rewind/compaction drops
  obsolete suffixes. Source cursors include hidden rows.
- A live `persisted_turn` receipt binds user/final-assistant rows before REST
  refresh. Reasoning and full tool activity payloads remain inspectable during
  the current turn. Accepted subagent events and turn starts are forwarded with
  runtime/replay/sequence/authority fences to the separate native spectator
  window manager.
- Slash discovery reads actual `commands.catalog` metadata, preserves installed
  extensions/skills, and omits declared terminal/messaging-only commands.
  Typing an absolute path is not parsed as a slash invocation. Multiline command
  arguments retain interior whitespace. Backend dispatch uses `slash.exec`,
  falls back only on a proven missing method to `command.dispatch`, and submits
  skill/send expansions through the durable conversation path. The visible
  invocation is retained separately from model-facing skill scaffolding.

## Verification

Isolated synthetic gateway socket contracts cover restore-only (no submit),
unknown rewind ACK recovery with the same UUID and fences, and the existing
conversation lifecycle suite. Focused chat tests cover projection, opaque reasoning carriers, tools,
catalog/extension discovery, owned branch recovery, alias cycles, completion
races and mismatched model-confirmation owners. History tests cover moving-tail
backfill and authoritative rewrites. Real socket tests additionally exercise
multimodal staging before rewind, invalid bytes, frozen restore-only input and
lost canonical policy ACK recovery. `check-chat.mjs` passed 13 native checks of
rich rendering, history-action UI, command keyboard/modifier behavior and
restored image/file chips against isolated fixtures, without an agent. The `rich-chat` scene is
synthetic; its example output is not a report from a live execution.


## Multimodal and slash increment

Stored user turns capture their exact original text, image/file sources and
public display text under the original connection/profile/stored-session owner.
Edit replaces only an unambiguous public text region; hidden attached context
remains intact. Every attachment is fetched and frozen into the private journal
before rewind. Send stages acknowledged image uploads/file references first,
then rewinds and submits one retained user input with separate canonical
`text`/`api_text` when its public and model-facing text differ. Invalid bytes,
unsupported parts and gateway limits fail before history changes. Replay is
bounded to 16 attachments, 5 MiB per attachment, 64 MiB frozen data and 2 MiB transport
text. Immutable Arc buffers avoid copying media on every native render.

Restore-only returns the complete frozen bundle after the rewind ACK and emits
no prompt/upload. An empty composer adopts it; a newer draft remains untouched
and the user can explicitly append the saved input. Draft persistence includes
this bundle and uses a version that older clients refuse without dropping it.
The confirmation captures revision/generation/authority when displayed, so a
new turn arriving during confirmation requires the user to review it again.

Canonical slash mutations persist their UUID, owner, policy/cwd and exact CAS
fences before I/O. Unknown receipts retry that same operation; expensive-model
confirmation gets a new request UUID on the same saved action. Generic legacy
commands cannot be replayed idempotently, so an unknown outcome requires explicit
acknowledgement after reviewing its effects. Startup recovery never runs a
command. Alias chains preserve multiline arguments and reject cycles/depth
exhaustion. A delayed skill expansion uses the originally captured policy;
a delayed prefill never overwrites newly typed text.

`complete.slash` supplies live argument candidates and replacement offsets.
Queries debounce 120 ms with at most 2 in flight, use strict owner/query fences and
UTF-16 boundaries, and reset on workspace changes. Up/Down selects a candidate,
Tab/Enter inserts it, and Escape preserves text while dismissing the menu.
The native transcript also consumes confirmed font/scale, bubble transparency,
timestamps and reasoning/tool disclosure preferences. Explicit manual closes
remain distinguishable from default-open preferences.

## Authoritative policy increment

Session snapshots, recovered snapshots, accepted `session.info` and canonical
model/reasoning mutation receipts now project explicit owner policy. Requested
reasoning and the route's actual wire level remain separate. Missing provider
metadata never reuses a different route's provider; an unlisted current model
still appears in the footer without fabricating a selectable catalog row.
Accepted deferred model/effort/tier choices belong to the next message while
observed session facts remain available separately. A refused deferred model
returns to committed facts. Canonical deferred guard events use the retained
model-confirmation surface, including explicit cancellation and newer-intent
and execution-fence checks.

Every draft has a persisted UUID and independent model/reasoning/tier/approval
user revisions. Send and slash intents capture those stamps before asynchronous
work. Admission acknowledgement clears only the exact captured field revision
of the same draft: A→B→A, another existing destination draft, delayed skill
expansion and restored journals cannot acknowledge newer intent. Old journals
without a stamp never clear dirty fields. Completed canonical policy receipts
are retained in the prepared-send journal so an explicit retry after a lost
prompt acknowledgement restores accepted deferred presentation without issuing
another policy mutation. Versionless profile settings are read back on recovery.

Clean fields follow accepted authority; dirty fields retain user intent.
Profile approval mode comes from the exact owner's confirmed configuration or
verified write/readback, independently of session YOLO and ACP edit policy.
Verified approval writes supersede older configuration reads and reconcile
other sessions of the same connection/profile. The independent conversation
bypass switch uses a retained exact session `config.set key=yolo` value without
`scope`, never a profile-mode write or a prompt. Canonical readback confirms the
session flag; legacy uses its exact session ACK and an owned snapshot because
there is no legacy YOLO getter. A legacy process/profile override that still
reports bypass active remains displayed with a failure message. Unknown outcomes
require explicit recovery; canonical recovery reads current state rather than
replaying a write over another client's possible later choice. Accepted notification cues are
emitted after runtime, replay epoch, sequence, authority and generation fences;
replay is explicit, and approval actions retain the actual prompt's generation
and offered choices. Socket-open cues describe real transport opens rather than
history hydration.

## Remaining parity work

- Provider/Codex sidecar detail reconstruction and folding are not exhaustive;
  image analysis summaries, citation navigation and all tool-specific rich
  presentations need their original contracts and acceptance cases.
- Reactions, transcript minimap/search/navigation, full selection/quote modes,
  specialized display preferences and export are not fully ported.
- Rich image/video/audio/PDF/document players, precise zoom/pan, image saving,
  generated-media galleries and media retry/eviction policies remain incomplete.
- Destructive message actions currently require the canonical revision-fenced
  gateway. Legacy mutating history paths need equivalent safe acceptance.
  Supported image/file turns replay from frozen originals; unsupported opaque
  provider content is refused before changing history.
- A fully acknowledged deferred pick is not exposed by the current canonical
  resume snapshot before its next-turn claim. After a fresh app restart with no
  unresolved send journal, the client shows the owner's observed route until the
  pick applies; it cannot prove a cached pick still wins over other clients.
  Legacy snapshots can report a pending selection instead of a running route,
  so the UI labels those facts as agent-reported rather than proven execution.
- The full slash local-action set, specialized session/theme inline pickers,
  fuzzy skill ranking and group presentation still need parity. Canonical
  model/reasoning/compress/branch/title directives, live aliases, shared fallback
  visibility gates and keyboard/argument completion are implemented. Commands
  with ambiguous outcomes are never auto-retried.
- Concurrent tiles, multiple independent draft windows and complete native
  subagent rich-media renderer sharing remain separate migration work.

Original contracts: `src/api/canonical-protocol.ts`, `app/chat/transcript-backfill.ts`,
`lib/chat-messages.ts`, `app/session/hooks/use-prompt-actions`, and
`components/assistant-ui/thread` under the retained `apps/desktop` baseline.

## Stream reconnection after a prolonged interruption

The worker now keeps retrying a lost stream while its conversation owner remains
alive, with backoff from two seconds to a maximum of 30 seconds. Reconnection
only resumes and reads the captured conversation; it never resends an uncertain
user submission. A recovered stream clears its own displayed connection error
without clearing unrelated errors or a retained uncertain-send warning.

A private loopback WebSocket regression passed through an established session,
two failed reconnect handshakes and reattachment to the same profile and stored
session, checking that no prompt is sent. A separate test exercises repeated
failures, bounded delay, and non-retry of a failed submission; another drives the
Viewer update path for recovery and retained errors. The exact-source Linux Rust
suite passed 954 tests with 15 ignored, and `cargo fmt --check` passed.

A follow-up covers opening an existing conversation while the gateway is down:
transport failures retry with the same profile and session; an explicit RPC
refusal stops automatic retries and remains visible. The two scenarios passed
against private loopback sockets, alongside the existing ownership tests. The
final Linux Rust suite passed 956 tests with 15 ignored, and formatting passed.

Before that follow-up, a Linux native-window run used the pinned real Hermes gateway in a private
profile and a deterministic local model stub. After a completed first turn, the
owned gateway was stopped for more than nine seconds and restarted. The same
stored conversation reattached, its connection error cleared, and a second turn
completed; each user message appeared once. Evidence, including failed harness
attempts and process identities, is under `/tmp/herune-reconnect-real-check/`.
This tests an idle conversation across a gateway restart, not interruption during
an active generation, a real model provider, or macOS. The pinned legacy
gateway's profile-unsafe sidebar live-status incompatibility remains open; see
`capabilities-mac-handoff.md`.

On 2026-11-02 the current `8edb25edd8` source was also built and exercised in a
Linux native window against the pinned Hermes gateway and a private local model
stub. The gateway was stopped while the first response was visibly streaming.
After restart the same conversation retained its partial response, left the
running state, and completed a second user turn. The first streaming request
was not resubmitted to the model; both user messages appeared once. The gateway
process identities exited and its private port closed. The acceptance covers one
profile and one chat; it does not establish cross-profile recovery, real model
provider behavior, or macOS acceptance. A previous fixture run held an auxiliary
model request instead of the main stream and is not used as proof. Compact
native evidence is retained locally at
`standalone-desktop-artifacts/reconnect-native-20261102/`.

## Short journal transactions and model selection

A journal state read and an owning send could contend for the same short-lived
file lock. Previously that contention immediately failed the send with the same
message used for an active claim by another window. State reads and atomic
writes now serialize; the separate network-spanning claim remains nonblocking and
still refuses a second owner. A regression reproduced the state-lock failure
before the fix. The Linux Rust suite passed 957 tests with 15 ignored, including
the existing cross-process claim checks; `cargo fmt --check` passed.

In a Linux native-window run against the pinned real Hermes gateway and a private
local OpenAI-compatible fixture, a custom provider advertised two models. The
user selected the second model and the fixture received that model in the actual
prompt request; the response completed. A previous run on the prior executable
failed with a journal-lock message after selection. The separate regression
establishes the lock race, but one successful repeat does not prove that race
was the sole cause of the prior failure. The fixture used no real credentials or
provider; macOS and other provider workflows remain unverified. Evidence for both
runs is retained at `standalone-desktop-artifacts/model-switch-native-20261102/`.

On 2026-11-02, two further native Linux runs used the pinned real Hermes gateway
with a private OpenAI-compatible fixture. In an existing chat, the second user
turn used the newly selected model and preserved the stored conversation and
first turn. A second run switched between two configured custom provider routes:
the second turn reached the second route with its selected model. Both routes
were distinct paths on one local test server. Each submitted user turn appeared
once; all known app and gateway processes exited. These checks do not establish
compatibility with real provider accounts or macOS. Evidence is retained under
`standalone-desktop-artifacts/model-existing-20261102/` and
`standalone-desktop-artifacts/provider-switch-native-20261102/`.

## Concurrent ordinary conversations

On 2026-11-02 a Linux native-window run used the pinned real Hermes gateway with
a private local model stub that held two streaming replies independently. Two
ordinary sessions on the same profile ran concurrently. Switching between them
retained their separate drafts; stopping the first left the second stream open,
and the second then completed with its draft preserved. Both histories were
reopened without the other conversation's user message. The stopped chat's draft
was deliberately cleared before pressing Stop because the composer shows Send
while a draft is present. All known app and gateway processes exited.

This is one source, one profile and a synthetic model provider, not proof of
cross-profile or real-provider behavior or macOS acceptance. The native evidence
is at `standalone-desktop-artifacts/parallel-sessions-native-20261102/`.

## Native text and image attachments

On 2026-11-02 a Linux native-window test used the actual GTK chooser and pinned
Hermes gateway in a private home. A text attachment and a PNG were selected in
successive turns of the same conversation. The gateway-staged files matched the
selected bytes, the text reached the model fixture, and both replies completed.
For the non-vision model fixture the PNG was represented to the model as a path
and an instruction to use `vision_analyze`; the test did not execute that tool
or establish image understanding. The raw harness check named `model request
included image` matches that textual hint, not inline image bytes. No real model
provider or macOS chooser was exercised. Evidence and the PNG hash check are at
`standalone-desktop-artifacts/attachments-native-20261102/`.
