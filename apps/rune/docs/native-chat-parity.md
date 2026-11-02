# Native chat migration

The native transcript uses real Rune/OpenCode Markdown and controls. Hermes owns
connection/profile/session identity and canonical gateway mutation semantics.
This is a working migration increment; complete chat parity remains in progress.

## Implemented

- Bot Chat lookup retries the exact-title, hidden-session read without the newer
  `scope` parameter only when an older gateway explicitly rejects that parameter.
  The retry retains the original profile; other failures still prevent creating a
  duplicate chat. A Linux native test against pinned Hermes `ef75bc7088`, with a
  private two-profile home and a local synthetic model, verified both chats,
  separate histories and draft retention across bot switches. A subsequent
  application Quit and relaunch reopened both original Bot Chats, retained the
  first draft, and sent a follow-up in the second chat. The gateway stayed running;
  actual model providers and macOS were not tested in these runs.
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

A later Linux native run disconnected a private TCP relay while the real pinned
Hermes gateway and synthetic model continued the active turn. The model finished
while the client was offline; after the relay returned, the same session showed
the complete reply and accepted a follow-up without resending the first prompt.
This covers one profile and a short outage, not a gateway restart, real provider
or macOS. Evidence: `standalone-desktop-artifacts/network-recovery-native-20261102/`.

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

A subsequent private Linux run against the same pinned Hermes backend held two
Bot Chat responses in different profiles concurrently. One completed in the
background while the other kept streaming; switching back retained distinct
histories and neither prompt was resubmitted. The model was synthetic; real
providers and macOS remain unverified. Evidence:
`standalone-desktop-artifacts/parallel-bots-real-20261102/`.

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

## Unsent drafts after restart

On 2026-11-02 a native Linux test used the pinned Hermes gateway and a private
local model fixture. Two stored conversations on one source and profile kept
different unsent drafts after normal Quit and relaunch; switching between the
conversations restored the correct text and sent neither draft. The executable
was `b6194456129fa99a3641b047ff2f623bb0483d63aa29d6c7a5b1a1bc8684cbe9`,
built at `18dd75ac72`; later plugin changes were not in that executable. The
first attempt failed because the fixture computed the wrong storage filename,
not because the draft was absent. Crash recovery, draft attachments, other
sources/profiles and macOS remain untested. Evidence is retained at
`standalone-desktop-artifacts/draft-restart-20261102/`.

The same first run exposed each GUI-created session twice in the native
sidebar: the `gui` source was included in both the recents and messaging
queries. The client now excludes `gui` from messaging in both the batched and
legacy requests. On the rebuilt Linux executable `9c938fc1999202003100a79f83d3956cfc228f7534d10360400b2e56c02b61db`,
the same isolated gateway scenario showed each of the two sessions once before
and after restart while preserving both drafts. A regression test also covers
equal IDs in separate profiles and Telegram classification. The full Rust
suite passed 958 tests with 15 ignored. The test fixture, red/green logs and
limits are at `standalone-desktop-artifacts/sidebar-gui-native-20261102/`.

## Larger chat images (2026-11-02)

The client previously rejected every selected attachment above 5 MiB before
upload. Images now accept up to 25 MiB through the canonical HTTP upload; a
legacy gateway that advertises desktop contract v5 or newer also accepts that
limit through `image.attach_bytes`. At that checkpoint, older or unknown legacy
gateways and non-image attachments retained the 5 MiB bound. Reads remain bounded even if a
file changes during staging, and the larger JSON allowance applies only to the
chat image-upload endpoint.

The 7 MiB canonical upload regression failed before the change and passed
afterward; modern and unknown legacy versions and 18 worker contracts passed.
The full Linux test run passed 963 tests with 15 ignored. A Linux native-window
run used the GTK file chooser, the pinned Hermes gateway and a private test
model: a 7,684,003-byte PNG was stored by the gateway with the exact original
SHA-256 and the chat received a reply. The tested binary SHA-256 was
`f3849a5dae9759ffe5baee0f01f08adb7130c1673d40c12c1064fbe853f18b40`.
This is one synthetic image and gateway, not proof for all providers or macOS.
Evidence is in `standalone-desktop-artifacts/large-chat-image-20261102/`.

## Larger chat documents (2026-11-02)

A gateway advertising desktop contract v5 or newer now also accepts non-image
chat attachments up to 25 MiB through the existing `file.attach` RPC. The prior
5 MiB bound remains for gateways with older or unknown contracts. A focused
regression demonstrated the former 5 MiB rejection and now verifies exact
bytes and the message reference for a modern gateway, plus refusal before a
large frame is sent to an unknown gateway. All 19 worker contracts and the
common Linux suite (964 passed, 15 ignored) passed.

A Linux native-window run selected a 7,340,548-byte PDF using the real GTK
chooser and sent it through the pinned Hermes gateway to a private model
fixture. The gateway stored the exact source bytes and the model request
contained the document reference. The tested binary SHA-256 was
`2d0bb81f5215894569a6c203131b4fe2d819d3f4dea6515777b7c4783d3b9e01`.
This does not prove macOS or real-provider behavior. Evidence is in
`standalone-desktop-artifacts/large-chat-document-20261102/`.

## Preserve drafts when an attachment is too large (2026-11-02)

The universal 25 MiB attachment limit is now checked before creating a saved
send or clearing the composer. A larger selected file leaves the original text
and attachment in the editor, with an error so the user can remove the file.
A regression in an isolated child process reproduced the previous empty
composer and now verifies retained text, removable attachment and no saved
send. Worker-side validation still handles changed files and lower limits on
older gateways; those later failures retain the existing saved-send recovery.

The Linux common suite passed 965 tests with 15 ignored. A native Linux run
using the GTK chooser and pinned Hermes gateway selected an oversized file,
confirmed no model request, removed it, then submitted the unchanged text to a
private model fixture and received a reply. The binary SHA-256 was
`4530ebb9678b1312be0a471675d26c4a9affc9286f30be0e42b7eb1f4ec0b801`.
This does not establish macOS or real-provider behavior. Evidence is in
`standalone-desktop-artifacts/oversize-draft-20261102/`.

A later fix also covers a lower limit discovered only after connecting. Drafts
with files remain in their captured editor until staging succeeds; completion
clears them only if the text and attachments are unchanged. A local preflight
refusal precedes rewinds, policy changes and uploads and leaves the saved send
for explicit discard, so a missing or oversized file can be removed without
losing the message. The editor is not rebound to a new lazy session before a
rejection. Unknown network outcomes retain the saved-send recovery behavior.

Linux native tests used pinned Hermes with a synthetic local model. A test-only
v4 contract override rejected a 6 MiB file while retaining the draft; after
explicit discard and file removal the text was sent in both a new ordinary chat
and a new Bot Chat. An unmodified v8 gateway accepted a 6 MiB file byte-for-byte.
The final source suite passed 970 tests, with 15 ignored. These checks do not
establish macOS or real-provider behavior. Evidence:
`standalone-desktop-artifacts/attachment-draft-preflight-20261102/`.

A legacy new-chat send interrupted during its first attachment upload can now be
retried when the same profile's resumed runtime is proven empty and idle. If
agent initialization is still starting, the worker waits briefly for that proof;
otherwise it retains the normal history check. Previously attempted sends never
use this shortcut. Linux native verification cut the first upload before the
pinned Hermes gateway, then retried through the UI: the file bytes and text
arrived, one user message was stored, and the synthetic local model replied.
This does not establish macOS or real-provider behavior. Evidence:
`standalone-desktop-artifacts/attachment-retry-native-20261102/`.

A follow-up fences this recovery before the journal is rewritten: if a newly
created legacy chat is resumed as a different stored ID before the first send,
the original saved input remains intact and no upload or prompt is issued.
Snapshots that explicitly identify another profile are refused; an omitted
profile remains compatible with older gateways. Existing chats can still follow
server-resolved compression continuations. Private socket and parser tests
cover the owner refusal; they do not establish malicious-server or macOS behavior.

### Legacy image retry after a lost acknowledgement (2026-11-02)

With Hermes desktop contract v2 or newer, image bytes are first staged as a file and
its path is retained with the saved send. Before attaching on each attempt the
same path is detached, so a lost image-attach acknowledgement does not queue a
second copy. Discard also detaches known paths on the captured runtime before
retiring the journal; an unconfirmed cleanup or changed runtime preserves it.
A first send to a confirmed empty lazy session can proceed after discard. Unknown or v1
legacy contracts retain their original upload behavior and do not get this retry
guarantee.

An isolated native Linux run against pinned Hermes cut the first successful
image-attach response. Before the fix the synthetic model received two image
references; afterward it received one with the original file bytes. A separate
native run discarded the send and then submitted text without the image.
This is not a real-provider or macOS acceptance claim. Evidence:
`standalone-desktop-artifacts/image-retry-native-20261102/`.

On 2026-11-02 the same safe retry was extended to contracts v2–v7: the
retained Hermes v2 source exposes `file.attach`, `image.attach`, and
`image.detach`, and the v5 source retains the same contract. Socket tests cover
v2, v5 and v8, as well as the unchanged v1/unknown direct-upload behavior. A
Linux native run used pinned v8 Hermes with its reported contract changed to v2
by a private test relay; it is not an actual v2-server or macOS acceptance.
Evidence: `standalone-desktop-artifacts/image-retry-v2-20261102/`.

### Model choice while two chats are active (2026-11-02)

A Linux native-window check used the pinned Hermes gateway and a private
synthetic model endpoint with two models. Two stored conversations streamed in
parallel. While the first was running, the user selected the second model,
switched to the other conversation and back, then sent the next message. It
reached the second model; the other conversation remained on the first model.
Another run queued the next message before the first stream finished and saw
the same result while the second conversation continued. Each relevant model
request occurred once. The first fixture attempt missed composer focus; it was
corrected and rerun. No client code changed. This is not real-provider or macOS
acceptance. Evidence: `standalone-desktop-artifacts/parallel-model-choice-20261102/`.

### Unsent files across restart (2026-11-02)

A private Linux native-window test created two stored conversations against the
pinned Hermes backend, attached a different text file to each draft through the
GTK chooser, then quit and restarted Herune. Both drafts and the right attachment
reappeared in their own conversation without being sent during restart. Sending
each afterward delivered its exact file bytes and text once to a synthetic model;
the other conversation's file was absent from each request. The actual backend
and UI were used, with model completion stubbed. This covers a normal restart,
not a crash, missing source files, macOS or another provider. The executable
was `4f1205aed8e64b73b78e44f697d79e630df943016544341831406691d7546a70`, built
from the source preceding `fd931b1a92` with its same client changes. Evidence:
`standalone-desktop-artifacts/draft-attachments-native-20261102/`.
