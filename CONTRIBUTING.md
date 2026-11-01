# Contributing

This repository maintains the standalone desktop client. Agent behavior belongs in an
external Hermes installation. Read `AGENTS.md` for ownership boundaries and interaction and state invariants.

For native Rune work, follow [the Mac/dev-01 development split](apps/rune/docs/development-split.md).
The JavaScript build and test commands below cover the extracted SDK, host, Bots
and shared code; native verification is specified in that guide.

Install with Node 26+ and npm 11.17+ using `npm ci`. Before submitting a change,
run `npm run typecheck`, relevant tests (`npm test` for the full client suite),
and `npm run build`. Native package changes also need the target-host recipe and
package fixture checks described in `apps/rune/packaging/README.md`.

Keep changes scoped. Include a behavior regression test for changes at connection,
profile, filesystem or persistence boundaries. The default suite must not import
or provision backend sources. External integration tests require explicit fixtures and temporary user homes.

Explain the resulting behavior and verification in pull requests. Preserve the
upstream MIT attribution. Rune parity and later UX redesign are separate stages;
do not combine interface redesign with extraction fixes.
