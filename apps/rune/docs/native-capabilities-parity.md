# Native agent plugin capabilities

This ledger concerns agent-managed plugins (`plugins.manage`), not Herune's
separate desktop UI plugin host. The gateway and its agent own installation,
configuration, activation and execution. The client issues scoped requests and
renders their results; it does not implement an installer or agent runtime.

The bounded synthetic contracts in the native test suite exercise the reviewed
source and full commit SHA, profile-scoped install/list/settings/toggle/update/
remove requests, authoritative list refreshes, a secret and nonsecret settings
transaction, and delayed responses across two sources. Mounted Rune controls
exercise inspection, installation, settings, toggles,
Viewer recreation, update consent and removal through an authenticated
loopback gateway. A separate synthetic chat peer connects the same profile's
plugin setting to a streamed tool result. These fixtures implement the wire
contract, not the Hermes
agent: they cannot establish compatibility with a real installer, repository,
provider, plugin execution, or a specific backend version.

An authoritative list that no longer contains the selected plugin now closes
its detail instead of leaving stale controls after removal. Installation binds
the identifier to the reviewed full SHA; the backend remains responsible for
its own scan and capability consent. Restart-required responses are displayed as
such. Settings errors retain unsent edits; an unconfirmed install response is
not automatically retried.

At that stage, acceptance still required a real external Hermes lifecycle,
process restart, actual plugin execution, update and macOS native verification.
The synthetic recreation is a fresh Viewer reading state held by the same
in-memory fixture peer, not a process restart. The existing desktop plugin SDK,
Bots and Wry regressions have a separate runtime and do not prove
this agent-managed lifecycle.

On 2026-11-01, a private read-only launch of external Hermes at
`bf0203a794a07aac3ff764972ab9087baa4e4f4e` answered the authenticated
`plugins.manage list` request. Its `inspect` action returned JSON-RPC 4017
(`unknown plugins action: inspect`). Its install handler accepts `ref` but does
not consume the client's `inspected_sha`; therefore source inspection and
installation cannot safely be treated as the reviewed-commit flow against that
version. The client guard remains in place. Real installation, update and plugin
execution in chat are still unverified.

That older installation is not the supported baseline. The baseline pins Hermes
`ef75bc708867e3884cb40a91363be6dc6fddc034`, whose gateway implements inspection
and passes `inspected_sha` to installation. A private launch of that exact
source inspected an HTTPS fixture and returned its full SHA without an insecure
warning. A SHA-bound install cloned the fixture and exposed it in the real list,
but returned an error while enabling it. Its nonsecret setting and removal were
then exercised through the real gateway. The native controls and actual tool
execution were not exercised against that backend. Plugin admission invokes an
explicit PM sync even with lazy installs disabled; that earlier acceptance run
did not authorize preparing another dependency environment. See
`/tmp/herune-capabilities-pinned-backend-20261101/REPORT.md` for the incident
and evidence; this is not a completed lifecycle.

A separate Linux native test against a synthetic peer disabled a plugin, quit the
application, launched a new process using the same private client state, read
back its setting, and reenabled it. This proves the application-process boundary
for that peer; the peer retained the plugin state in memory throughout, so it is
not evidence of real backend persistence or macOS acceptance.


A subsequent private Linux run prepared the pinned backend with its exact lock
using Hermes PM. The actual gateway inspected and installed an owned HTTPS Git
fixture at the reviewed SHA, wrote a nonsecret setting, disabled and reenabled
it, and updated v1 to v2. Native controls then changed the setting, toggled the
plugin, removed it with its detail closing, and inspected and installed v2.
A separate native Quit/relaunch read the real enabled v2 row and setting from
the same backend in two distinct processes. The backend was also restarted on
the same private home. These observations are Linux-only and do not substitute
for macOS acceptance. A fresh native chat invoked the real fixture through the deferred-tool bridge
and displayed the configured v2 result, with only the model completion stubbed.
The private session explicitly selected the fixture toolset. Evidence is recorded
in `/tmp/herune-capabilities-admitted-backend-20261101/REPORT.md`.

The isolation-corrected native run also installed fixture v1, updated it to v2,
and removed it with an authoritative absence and closed detail. The update did
not widen capabilities, so no additional consent override was needed.

## Bounded goal handoff

The everyday agent-plugin lifecycle has Linux evidence for reviewed install,
settings, toggles, actual tool execution, process restart/readback, update and
removal. The subsequent HTTP session-header fix passed 951 Rust tests with 15
ignored and native stored-history reopening without HTTP 401; SDK and Bots Wry
smokes passed on that corrected executable. The unchanged plugin update/RPC
controller retains the earlier actual v1-to-v2 evidence. Only model completion
was stubbed; Hermes and the plugin handler were real.

This accepts the plugin goal, not the broader native harness: sidebar live
status still reports RPC 4000 on the pinned legacy headless dispatcher. Its
process-wide untagged list is not used as a profile-scoped substitute. The
existing error remains explicit and needs a separate compatibility slice.
The raw HTTP-auth manifest therefore remains partial for that additional gate.
macOS acceptance and complete SDK/Capabilities parity remain open. See
`capabilities-mac-handoff.md` for the receiving-lane checks and exact contract.

On 2026-11-01 a follow-up fixed direct URL HTTP session-token placement: HTTP
requests now use the sensitive `X-Hermes-Session-Token` header, while WebSocket
requests retain their query token. The pinned backend accepted that HTTP header
and rejected a wrong key; the isolated exact-source Rust suite passed 951 tests
(15 ignored). A corrected Linux native binary completed a real fixture tool
turn, reopened its stored history after Quit and a new process, and removed the
plugin. HTTP history and roster no longer showed 401. This is **not a completed
acceptance**: the sidebar still displayed RPC 4000 on the legacy headless
backend. Its `session.list` contract rejects the canonical `scope` parameter;
its alternative `session.active_list` returns untagged process-wide rows and
cannot safely be assigned to an arbitrary profile. Evidence and the misleading
raw harness pass flag are explained in
`/tmp/herune-capabilities-http-auth-green-20261101/REPORT.md`. macOS, a real
paid provider, and managed Cloud remain untested.
