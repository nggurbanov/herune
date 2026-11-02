# Native plugin host

This module embeds the extracted `@hermes/plugin-sdk` and bundled Bots in the Rune plugin WebView. It uses the native parent's opaque socket receipts and owner-qualified IPC, with no runtime import from `apps/desktop`. Source derived from Hermes Desktop and Rune at `1f08da749c65f511667b02eacb5b8ed46a2f8c04` is MIT-licensed; see `LICENSE` and the generated third-party notices.

The native host's workspace scope update is asynchronous: `host.setWorkspaceScopeAsync` resolves only after the owner-checked native action succeeds. The older synchronous `setWorkspaceScope` returns true only when that exact state has already been acknowledged; it does not start an update. Bot call sites await the async operation. Native new-chat requests from the plugin host use the accepted target, and blocked targets produce an error. Native toolbar paths outside this plugin-host action are not wired to this scope.

The first native locale catalogue is English. Connector account changes and toolset provider/credential edits are explicitly unavailable in the embedded views; these views display their limitations. Status for sessions outside the active snapshot is marked unavailable. Actual native/macOS platform validation is separate from module and synthetic browser tests.

Unread-marker operations are not yet implemented by this host. Bots continue
processing roster activity and notices if that optional capability is missing;
a confirmed deletion on a host that supports deletion also finishes its local
cleanup if unread cleanup is unavailable. This does not add unread indicators or
profile deletion to the native host.

The SDK exposes the identity-tracing callback only when the native host actually
provides it. Bots can therefore update roster metadata without a diagnostics
facility; this does not add native profile creation or deletion support.

The browser-only `dropLeftoverProfilePrefs` capability is optional. The native
host does not provide it, so creating or duplicating a bot proceeds without a
browser preference cleanup step. This does not clear native persisted drafts
for a profile deleted and recreated outside the application; native profile
deletion and that cleanup remain separate work.
