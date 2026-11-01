# Capabilities and HTTP token handoff

Base: `d4b1392ccdb772298d61a888d2d363a1460e5c40`.
First batch: `c2c57ee2fe900e4d98a01f014066398956fb843d`.
The following transport batch is published on `feat/standalone-desktop`.

## Changes

- An authoritative plugin list closes the detail of a removed plugin.
- Direct and saved URL session-token HTTP requests use sensitive
  `X-Hermes-Session-Token` headers, keeping the captured credential out of HTTP
  query strings. WebSocket query authentication remains unchanged.
- Existing OAuth/Bearer, native ticket and credential-free external-media paths
  retain their contracts. Profile/source fences remain in place.
- Registered Capabilities lifecycle, owner/error and authentication regressions
  and native diagnostic scripts are included. No Mac identity, visual,
  packaging, SDK implementation or generated host assets changed.

## Verification

Final restored-source Rust gate: 951 passed, 15 ignored. The corrected Linux ELF
is `6a1a26e2db6d787418ccd28595c976c1e7b5f0e3349a1989774a49b2593584dd`.
The actual pinned Hermes backend inspected/installed a reviewed HTTPS fixture,
saved settings, toggled it, executed its tool in a fresh chat, retained state
through native and backend restarts, updated v1 to v2 and removed it. The model
was a private deterministic completion service. The corrected ELF reopened the
stored result after native Quit/relaunch without history or roster HTTP401.
Its SDK and Bots Wry smokes also passed with synthetic peers.

Actual update did not widen capabilities; scan/consent changes and lost replies
have separate synthetic regression coverage. A gateway older than the pinned
inspection/SHA contract may refuse installation; no unsafe fallback is added.

## Mac checks

Integrate the feature checkpoint once into the visual branch using the existing
development split. Build/test through the isolated Herune Dev workflow. Check
Capabilities plugin list/detail, reviewed install, settings, toggles, tool use in
a fresh chat, restart/readback, update and removal against an explicitly chosen
compatible gateway. Check a direct URL session-token connection's roster and
history; confirm the existing OAuth connection still works. Do not replace the
installed production app or migrate its credential/state namespaces as part of
this handoff.

## Remaining boundary

The pinned legacy headless backend rejects canonical sidebar live-list scope.
Its alternative returns process-wide rows without trustworthy profile identity;
the client retains an explicit RPC4000 error instead of assigning those rows to
a profile. That separate live-status compatibility issue remains open. This is
not full application, SDK, macOS or Windows acceptance.

Detailed local evidence is under
`/tmp/herune-capabilities-admitted-backend-20261101/` and
`/tmp/herune-capabilities-http-auth-green-20261101/`; Root's scoped completion
audit is `/tmp/herune-capabilities-goal-audit-20261101.md`. Earlier raw manifests
remain partial for broader harness gates and are not rewritten as green.
