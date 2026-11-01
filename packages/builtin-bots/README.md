# Built-in Bots

This package contains the existing Hermes Bots plugin, extracted from
`apps/desktop/src/plugins/hermes-bots` at Herune baseline
`1f08da749c65f511667b02eacb5b8ed46a2f8c04`. Its default export is the plugin
manifest; register it in a host that implements the public
`@hermes/plugin-sdk` contract. Bots, routines, groups, screens and profile
configuration remain the original implementations. The SDK and React must be
shared with the host as singleton modules. No desktop renderer import is used.

`node build.mjs` bundles the plugin and writes `dist/inputs.json` with a guard
against Desktop inputs. The host must provide the SDK, React and nanostores;
noVNC is bundled for the screen feature. The native host integration and SDK
contract are still in progress; a successful externalized bundle alone does not
establish integration readiness. Tests use private synthetic services, never a
real gateway or user data.

The plugin is MIT-licensed by Nous Research; see LICENSE and UPSTREAM-LICENSE.
The build includes noVNC, whose license is in its installed package at
`@novnc/novnc/LICENSE.txt`; distributors must include its notice as well as
notices for other dependencies in their final bundle.
