# Herune: Mac visual work and dev-01 core work

Approved by Nihad on 2026-11-01. This is a working agreement for the two existing
sessions, not a request to create more agents or complete the migration differently.
PRODUCT.md and DESIGN.md still define the accepted behavior and visual references.
New visual requests from Nihad take precedence over older visual decisions.

## Owners

**Mac session: presentation and native interaction.** Typography, colors, spacing,
icons, borders, sizing, panel composition within the accepted design, scrolling,
hover/focus, hit targets, loading/error presentation and visual accessibility.
The Mac also owns the fast native preview workflow and actual macOS acceptance.
Do this work locally; it is an explicit exception to the usual dev-01 default.

**Existing dev-01 session: functionality and integrations.** Gateway/RPC protocols,
OAuth and credential lifetimes, providers, settings validation/read/write,
connection/session/profile ownership, persistence/migrations, message ordering,
stream recovery, retries, terminal/files, audio engines, plugins and runtime work.
It continues its current integration scope; the visual lane does not replace or
pause that work. Backend settings need to work, not merely look complete.

**Connection quality is evidence-driven shared work.** The Mac reproduces real
failures, captures a bounded trace and verifies the fix in the actual app. A narrow
macOS/client lifecycle defect may be fixed here after taking ownership of the
specific affected files. Shared transport, auth, replay/retry or protocol changes
normally go to dev-01. Neither lane simultaneously patches the same cause.
Server deployment/configuration changes are not implied by this agreement.

## Code boundaries

- The Mac normally edits the presentation in `apps/rune/src/view/`, visual assets,
  theme/palette code and visual acceptance fixtures.
- dev-01 normally edits `apps/rune/src/connections*`, `gateway*`, `oauth*`,
  `conversation*`, `chat*`, `client*`, `pages*`, `operations*`, `audio*`,
  `terminal*`, persistence and their behavior tests. These are actual source stems,
  not a rule to rewrite every similarly named module.
- `src/view.rs`, `src/app.rs`, view action closures, settings/connection forms,
  composer/sidebar models, window lifecycle, manifests/lockfiles, packaging and
  Rune vendor patches are shared boundaries. `view/` is not presentation-only.
  In particular, preserve scope checks, action identity, disabled/busy guards,
  secure inputs and error behavior when changing the appearance of a control.
- A new integration may need a small view adapter on dev-01. Agree on the exact
  files first; deliver the adapter separately from cosmetic changes. Mac polish
  uses its typed state/actions rather than duplicating business rules.
- Prefer an existing action/view seam. Split a shared file only when a concrete
  change requires it; do not start a broad UI architecture rewrite as setup work.
  Do not replace unfinished functionality with fake success or fixtures in live UI.

Routine work within a lane needs no per-edit permission. When a task crosses the
boundary, record the owner, affected paths, baseline SHA and changed contract in
its handoff. Ownership is established when the other session acknowledges it or
has explicitly handed off those files; a note written in one checkout is not a
distributed lock. If ownership is unresolved, continue in independent files.

## Branches and exchanging changes

- Shared reviewed baseline: `origin/main` in `nggurbanov/herune`.
- Mac checkout: `/Users/tyrell/Projects/hermes-desktop-rune`, branch
  `feat/macos-visual`, created from baseline
  `1f08da749c65f511667b02eacb5b8ed46a2f8c04`.
- Existing dev-01 checkout:
  `/home/ubuntu/Worktrees/hermes-desktop-rune/standalone-desktop`, branch
  `feat/standalone-desktop`. Do not switch/reset/rebase the other session's checkout.
- Keep visual work and functional changes in separate small commits. A reviewed
  batch states its base/head SHA, touched files, any state/action contract change,
  evidence and limitations. For a pure visual batch, state that its action contract
  is unchanged. The receiving session reviews and integrates the batch once;
  never both merge and cherry-pick the same patch.
- Use Git commits/PRs for exchange. Do not mirror live working trees or copy a whole
  source snapshot over another checkout. Never transfer `target`, `node_modules`,
  credentials, app preferences or caches to synchronize source.
- Pull reviewed core checkpoints into the Mac visual branch between visual batches.
  Fetch first; merge the checkpoint when the branch has visual commits. A private,
  unpublished branch can instead be rebased after preserving its work. Never
  force-push a shared branch or silently resolve a conflict by discarding a lane.
- Exactly one named session integrates a particular batch into `main`; name it in
  the handoff. Neither session assumes the other has stopped editing because a
  commit or documentation file appeared. Do not publish or replace the installed
  app merely because a batch is ready.

## Fast native preview

The intended loop is: visual request -> small local edit -> incremental macOS dev
build -> refresh/restart the dev client -> native inspection -> next visual request.
The normal installed Herune remains available as the working baseline.

The next implementation step is an isolated **Herune Dev**, not a release package
per edit. Give it a persistent Cargo target, distinct app identity and isolated
client state. A distinct window title/bundle identifier alone does not isolate
preferences, drafts, window state or credential namespaces. Do not launch it
against the same writable state as the installed app; do not copy live tokens
into files to avoid a login. Reuse the supported authentication flow and keep the
existing installed app's storage/credential identities compatible.

**Current limit:** `client::state_dir()` still uses the existing OS application
support directory. This document does not implement dev-state isolation, a file
watcher or arbitrary Rust hot reload. Do not claim those features already work.
Read-only visual fixtures can be used before a safe live dev namespace exists.
Live design tokens can be added after that loop is established; Rust structural
and behavior changes still require rebuilding/restarting the relevant process.

During a visual loop, inspect the changed scene plus relevant light/dark, focus,
scroll and window-size states. Run focused behavior checks if interaction changes.
Before integration, run formatting and the relevant native tests; the full native
suite runs on dev-01 for the batch/CI. macOS-only behavior is checked on macOS.
Do not use the Electron build or Linux renders as proof of the Mac's native UI.

## Connection-failure handoff

For an observed drop, record:

- App source/build identity, macOS version and timestamp with timezone.
- The affected connection/profile/session using only non-secret identifiers;
  the user action and expected versus observed behavior.
- Whether the socket closed, the app slept, a request failed, streaming paused or
  only the displayed connection status became stale; include close/error codes
  and a short redacted trace when available.
- Whether another client still worked and how the actual client recovered.
  These observations bound the diagnosis; an HTTP health check is not chat proof.
- Owner, exact files for a proposed fix and the regression to verify on the Mac.

Never log tokens, authorization headers, cookies or entire private conversations.
Do not conceal an interruption with a success indicator or blindly resend a turn:
preserve message identities, order, drafts and the existing unknown-send recovery.
After a shared/core fix is integrated, the Mac verifies the original real scenario,
including the relevant resume/history behavior, rather than declaring success from
a server health response alone.

## Status of this agreement

The role split, local visual branch and repository instructions are established.
Identical agreement files are placed in the existing dev-01 checkout for its next
read. This does not claim an already-running session has read or acknowledged
them. No session is interrupted and no live client/backend behavior is changed by
the workflow setup. The native dev preview remains a separate implementation task.

## Root native commands (integration in progress)

From the repository root, with Node 26+, a supported npm (11.17+), Rust 1.95.0,
and platform prerequisites installed, use `npm ci`, then `npm run dev` to
regenerate the plugin host and run the native client. This is not the isolated
Herune Dev preview and has no watcher or hot reload. `npm run build` regenerates
that host and builds a locked release; `npm run build -- --target TRIPLE` puts
it in `apps/rune/target/TRIPLE/release/`. Without a target it is in
`apps/rune/target/release/`.

`npm run pack -- --out /tmp/Herune.app --version 1.2.3` on macOS builds from
source and assembles an unsigned app. `npm run dist -- --out /tmp/Herune.app
--version 1.2.3 --zip /tmp/Herune.zip` also creates a zip. Output paths must not
exist; choose a numeric version deliberately. Add `--target TRIPLE` if needed.
Linux and Windows use their existing recipes and required host-specific options;
see `apps/rune/packaging/README.md`. Pack and dist forward recipe options; they
never replace an installed app. Signing and notarization remain explicit recipe
options. The retained SDK/host sources are being finalized; these commands are
subject to the frozen-source integration gate before they are considered accepted.
