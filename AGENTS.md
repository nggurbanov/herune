# Herune development

This repository owns a standalone desktop client. It does not contain or maintain
Hermes agent execution, the Python package manager, messaging gateway, CLI, TUI,
website, or the upstream installer. The archived Electron interface is the parity
baseline for the native Rune port. Preserve placements and behavior while using
the user-selected OpenCode Rune theme and components. Structural redesign is later.

## Two-session ownership (2026-11-01)

Read [the development split](apps/rune/docs/development-split.md) before native work.
The Mac session owns visual/interaction polish and native macOS verification;
local edits and native builds are explicitly authorized for this lane. The existing
dev-01 session owns integrations, configuration semantics and core behavior.
`view/` mixes presentation with actions: its directory name is not an ownership
boundary. Shared files have one agreed editor at a time. Observed connection
failures may be diagnosed on the Mac; changes to shared transport require a
specific handoff. Preserve the installed app and real user state during previews.

## Layout and commands

- `packages/`: extracted plugin SDK, bundled Bots and native plugin host.
- `apps/shared`: gateway client, types and frozen protocol compatibility artifacts.
- `apps/rune`: native Rust/Rune client.
- `scripts/build`: native build and packaging entry point.
- `desktop-baseline.json`: upstream snapshot provenance and migration status.

Use Node 26+ and npm 11.17+; run `npm ci` at the repository root. Run
`npm run typecheck`, relevant Vitest behavior tests, and `npm run build`. Packaging
changes also require the target-host native recipe and package fixture checks in
`apps/rune/packaging/README.md`.
Do not provision an agent or Python environment to build or unit-test this client.
The optional external contract/E2E lanes require an explicitly selected external
Hermes installation and isolated user homes.

## Boundaries

- Hermes owns agent profiles, sessions, memory, tools and execution. Use the
  existing gateway APIs; do not reproduce agent behavior in the UI.
- Normal local launch invokes the installed `hermes gateway ensure --json` and
  authenticates with private, transient native tickets. Closing the client must
  leave the canonical gateway running. Remote failures never start a local owner.
- Herune owns this app's connections, preferences, plugins, logs and windows in
  its own client data. Explicit agent configuration operations remain agent-owned.
  Never migrate or delete external agent data as a desktop startup side effect.
- Renderer state must declare connection/profile/session scope. The backend is
  authoritative for state other Hermes clients can change. Preserve Bot Chat's
  `(profile, title = "Bot Chat")` identity; never use recency or a stored ID pin.
- Keep the native plugin capability bridge narrow. Plugin renderer code has no direct Node API.
- Preserve generated gateway/slash snapshots with provenance. Updating upstream
  compatibility is an explicit task, never a build-time source dependency.

Prefer feature-owned nanostores, thin routes, narrow hooks, shared interfaces and
table-driven dispatch. Test user behavior and authority boundaries; do not inspect
backend source text or freeze incidental implementation details in tests. Never
write tests to a real Hermes home or use live provider credentials implicitly.
Preserve MIT attribution and third-party notices. Do not contact the user through
Hermes/Telegram for tasks started manually in T3 unless explicitly asked.

## Rune port

Each host keeps one persistent Cargo target root for its active native checkout;
serialize builds sharing that target. Mac and dev-01 lanes can run independently.
Do not copy dependency directories, target outputs or caches between hosts.
Keep the latest verified checkpoint and unique data needed to continue work.
After checking references and preserving needed data, remove unused temporary
builds, unpacked duplicates and obsolete checkpoints. Routine cleanup is already
authorized by the user. Monitor target allocation and free space before, during,
and after builds; stop before resource pressure threatens the host.

Read PRODUCT.md, DESIGN.md and apps/rune/README.md. Native Rune code is separate
from the Electron baseline. Keep Rune/runtime/kit/theme pinned to one Git revision
and commit the Cargo lockfile. Reuse upstream OpenCode components and selected
view functions with recorded provenance and notices. OpenCode transport, fixture
fallbacks, single-session IDs and its Beta storage are not Hermes semantics.
Before integrating a native batch, run npm run test:rune on dev-01 and
cargo fmt --manifest-path apps/rune/Cargo.toml --check. Run macOS-specific checks
on the Mac. During interactive visual edits, use focused render/interaction checks;
the full suite belongs to a reviewable batch, not every spacing adjustment.
Inspect actual native renders; an element-tree dump does not establish platform
screen-reader support. Never claim full parity from the first read-only slice.
