// Public contract extracted from Hermes Desktop at 1f08da749c65f511667b02eacb5b8ed46a2f8c04.
import type { ReadableAtom } from 'nanostores'
type KeybindCategory = 'composer' | 'profiles' | 'session' | 'navigation' | 'view'
import type { ReactNode } from 'react'
import type { GatewayEvent } from '@hermes/shared/gateway-events'
import type { Contribution } from './contribution'
import type { PluginI18n } from './i18n/ports'
type GatewayEventListener = (event: GatewayEvent) => void



/** A contribution as a plugin author writes it — provenance + id scoping are
 *  the host's job, so those fields are off-limits here. */
export type PluginContribution = Omit<Contribution, 'source' | 'id'> & { id: string }



/** Namespaced JSON persistence (the VS Code `globalState` analog). Keys live
 *  under `hermes.plugin.<id>.` — plugins can't read or clobber each other. */
export interface PluginStorage {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
  remove(key: string): void
}



/** The curated OS door — every way a plugin reaches outside the app window,
 *  in one attributed namespace instead of the raw `window.hermesDesktop`
 *  bridge. Every member resolves a result instead of throwing when the
 *  capability can't apply (no Electron shell, older desktop build), so
 *  callers branch on the return value rather than sniffing the bridge. */
export interface PluginOs {
  /** Native OS notification (Electron), attributed to this plugin. Gated by
   *  Settings ▸ Notifications ▸ "Plugin notifications" and fires only while
   *  the user is away from Hermes — use `host.notify` for the in-app toast.
   *  Throttled per plugin; reserve it for genuinely notable events.
   *  Supports `icon`, `activate` (e.g. `hermes://index-network/intent/1`),
   *  action buttons, and renderer `onActivate` / `onAction` callbacks. */
  notify: (input: PluginNativeNotificationInput) => void
  /** Open a URL with the OS default handler (browser, mail client, custom
   *  schemes like `spotify:`). Resolves false when the shell can't. */
  openExternal: (url: string) => Promise<boolean>
  /** Reveal a path in the OS file manager (Finder / Explorer). Resolves
   *  false when unavailable. */
  revealPath: (path: string) => Promise<boolean>
  /** Native save dialog. Resolves the chosen path, or null on cancel /
   *  when unavailable. The path is on the BACKEND's filesystem, so hand it
   *  to a `rest` call rather than trying to write it from the renderer. */
  pickSavePath: (options?: PluginFileDialogOptions) => Promise<null | string>
  /** Native open dialog, single file. Resolves the chosen path, or null on
   *  cancel / when unavailable. */
  pickOpenPath: (options?: PluginFileDialogOptions) => Promise<null | string>
  /** Write text to the system clipboard. Resolves false when unavailable. */
  writeClipboard: (text: string) => Promise<boolean>
}



/** The pet door: short lines in the core pet's speech bubble, attributed to
 *  this plugin, instead of locating the pet in the app DOM and drawing over
 *  it. The host renders them in the in-window pet and the pop-out overlay;
 *  they show only while the user has a pet visible. */
export interface PluginPet {
  /** Show one plain-text line (no HTML; control characters stripped, capped
   *  at 120 chars) with this plugin's name as a small label. Lasts `ttlMs`
   *  (default 6 s, clamped 1–30 s); the same `id` replaces in place. Core
   *  error / waiting-on-you states keep priority over it. Rate-limited per
   *  plugin. Returns a disposer that removes the line early. */
  say: (text: string, options?: PetSayOptions) => () => void
  /** Remove one line by `id`, or every line this plugin has up. */
  clear: (id?: string) => void
  /** True while a pet is installed and shown (in-window or popped out). A
   *  plugin can fall back to its own chip or pane while this is false. */
  visible: ReadableAtom<boolean>
}



export interface PluginFileDialogOptions {
  defaultPath?: string
  filters?: Array<{ extensions: string[]; name: string }>
  title?: string
}



export interface PluginContext {
  /** The resolved plugin source tag, e.g. `'plugin:cost-meter'`. */
  readonly source: string
  /** Register one contribution (id namespaced, source stamped). */
  register: (c: PluginContribution) => () => void
  /** Register several at once; the returned disposer removes all of them. */
  registerMany: (cs: PluginContribution[]) => () => void
  /** Add this plugin's page (and optional sub-pages) to Settings ▸ Plugins.
   *  Removed with the plugin on disable/unload. Feature-detect on older hosts:
   *  `ctx.registerSettingsPage?.(...)`. */
  registerSettingsPage: (page: PluginSettingsPage) => () => void
  /** Register an arbitrary cleanup to run on unload/disable — for side effects
   *  that aren't contributions or sockets (store subscriptions, timers). Runs
   *  alongside every other disposer when the plugin deactivates. */
  onDispose: (fn: () => void) => void
  /** Hear the gateway stream by event type (`'*'` = everything). Tracked like
   *  every other registration: unload/reload/disable removes the listener, so
   *  a subscription made after `register()` returns (a timer, a socket
   *  callback) can never outlive the plugin the way a bare `host.onEvent`
   *  there would. */
  onEvent: (type: string, listener: GatewayEventListener) => () => void
  /** Scoped timers: cleared when the plugin unloads/reloads/disables, so a
   *  poller cannot outlive the plugin the way a bare `setInterval` does (the
   *  host never sees a bare global — it is the author's leak). Each returns
   *  a disposer that cancels early. */
  setTimeout: (fn: () => void, ms: number) => () => void
  setInterval: (fn: () => void, ms: number) => () => void
  /** Scoped `addEventListener` on any target (window, document, a node):
   *  removed on unload/reload/disable. Returns a disposer. */
  addEventListener: (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean
  ) => () => void
  /** REST to this plugin's own backend namespace (`/api/plugins/<id>`); `path`
   *  is relative ('/board'). The sanctioned door for a plugin that ships a
   *  `plugin_api.py` — profile-aware, namespace-scoped by construction. Use
   *  `host.request` for gateway JSON-RPC. */
  rest: <T>(path: string, opts?: PluginRestOptions) => Promise<T>
  /** Live twin of `rest`: a WebSocket to this plugin's own namespace
   *  ('/events'), JSON frames to `onMessage`, auto-reconnect, disposer
   *  returned. Resolves to a no-op on OAuth remotes — treat it as an
   *  accelerator over your polling, never a replacement. */
  socket: (path: string, onMessage: (data: unknown) => void) => () => void
  /** The curated OS door: native notification, open-external, reveal-in-file-
   *  manager, clipboard — attributed to this plugin, result-shaped (never
   *  throws for a missing capability). */
  os: PluginOs
  /** The pet door: lines in the core pet's speech bubble, attributed to this
   *  plugin and cleared when it unloads. Feature-detect on older hosts:
   *  `ctx.pet?.say(...)`. */
  pet: PluginPet
  /** Run a built-in app action (toggle the browser panel, open Settings,
   *  focus the composer, …) through the same handler its keyboard shortcut
   *  and palette entry use, so rebinding or unbinding the shortcut changes
   *  nothing. Only view / navigation actions are allowed (`listActions()`);
   *  an unknown or denied id is refused with `{ ok: false, error }` and a
   *  console warning, never thrown. Feature-detect on older hosts:
   *  `ctx.runAction?.('view.showBrowser')`. */
  runAction: (id: PluginAppActionId) => PluginRunActionResult
  /** The actions `runAction` accepts, with their localized labels. */
  listActions: () => PluginAppActionInfo[]
  /** Run JavaScript in the preview Browser page. Closed unless the plugin
   *  declares `capabilities: ['preview.executeJavaScript']`, and even then
   *  the app asks the user once per page origin before anything runs.
   *  Feature-detect on older hosts: `ctx.preview?.executeJavaScript`. */
  preview: PluginPreview
  /** Plugin-scoped persistence. */
  storage: PluginStorage
  /** Folder-scoped file access: this plugin's own data folder plus folders
   *  the user grants it through the app's picker, by relative path. The app
   *  checks every call; nothing outside those folders (or inside Hermes'
   *  own data) is reachable. Feature-detect on older hosts: `ctx.files?.…`. */
  files: PluginFiles
  /** Plugin-scoped i18n: ship + register locale bundles under this plugin,
   *  resolved against the app's active locale — no core `en.ts` edit. */
  i18n: PluginI18n
}



export interface HermesPlugin {
  /** Stable slug — becomes the `plugin:<id>` source and the id namespace. */
  id: string
  /** Human name for settings / about UI. */
  name?: string
  /** One-liner for the settings inventory (what the plugin adds). */
  description?: string
  /** Registers on load when the user hasn't chosen (default true). Set false
   *  for opt-in plugins: they inventory in Capabilities ▸ Plugins, off until the
   *  user flips the switch. */
  defaultEnabled?: boolean
  /** Sensitive doors this plugin uses, declared up front so the app can show
   *  them and gate them. Today: `'preview.executeJavaScript'` (`ctx.preview`).
   *  A door the plugin did not declare refuses every call. */
  capabilities?: readonly string[]
  /** Called once at load; wire contributions through `ctx`. */
  register: (ctx: PluginContext) => void
}



export interface PluginFolder {
  /** Opaque handle to pass as `folder` to the other calls. */
  id: string
  /** The folder's name, for display. */
  name: string
  /** Absolute path the user picked, for display only — calls take `id`. */
  path: string
}



export interface PluginFileEntry {
  name: string
  /** Relative to the folder, `/`-separated; pass it back as `path`. */
  path: string
  isDirectory: boolean
}



export type PluginFilesResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message: string }



export interface PluginFiles {
  /** Handle of this plugin's private data folder (always available). */
  readonly dataFolder: 'data'
  /** Ask the user for a folder with the app's own picker. `folder` is null on
   *  cancel. A folder holding Hermes data is refused (`error: 'protected'`)
   *  and the app tells the user why. */
  requestFolder: () => Promise<PluginFilesResult<{ folder: PluginFolder | null }>>
  /** Folders the user has granted this plugin and not revoked. */
  folders: () => Promise<PluginFolder[]>
  /** Give a granted folder back (the user can also revoke it in Settings). */
  release: (folderId: string) => Promise<boolean>
  list: (folder: string, path?: string) => Promise<PluginFilesResult<{ entries: PluginFileEntry[]; truncated: boolean }>>
  stat: (
    folder: string,
    path: string
  ) => Promise<PluginFilesResult<{ exists: boolean; isDirectory?: boolean; mtimeMs?: number; size?: number }>>
  /** UTF-8 text up to 4 MiB; a binary or larger file is refused, never truncated. */
  readText: (folder: string, path: string) => Promise<PluginFilesResult<{ mtimeMs: number; size: number; text: string }>>
  /** A file (up to 16 MiB) as a `data:` URL, for image previews. */
  readDataUrl: (folder: string, path: string) => Promise<PluginFilesResult<{ url: string }>>
  /** Write up to 4 MiB of UTF-8 text. The parent folder must exist;
   *  `exclusive` refuses to replace an existing file. */
  writeText: (
    folder: string,
    path: string,
    text: string,
    options?: { exclusive?: boolean }
  ) => Promise<PluginFilesResult<{ mtimeMs: number; path: string; size: number }>>
  /** Rename in place (same parent folder); `name` is one plain name. */
  rename: (folder: string, path: string, name: string) => Promise<PluginFilesResult<{ path: string }>>
  /** Move to the OS trash (recoverable). The folder itself cannot be trashed. */
  trash: (folder: string, path: string) => Promise<PluginFilesResult>
}



export interface PluginPreview {
  /** True when this plugin declared `preview.executeJavaScript` and this
   *  window has a live Browser page for the focused session. Says nothing
   *  about the user's consent — that is asked on the first call. */
  isAvailable: () => boolean
  /** Run `code` in the focused session's active preview Browser tab and
   *  resolve its completion value. Always a Promise; rejects when the
   *  capability is undeclared, no page is open, the page is not a web
   *  origin, the user did not allow it, or the page changed origin. */
  executeJavaScript: (code: string) => Promise<unknown>
}



export interface PluginSettingsSubpage {
  /** Unique within the page; becomes the `ppage` URL param. */
  id: string
  title: string
  render: () => ReactNode
}



/** What `ctx.registerSettingsPage` accepts. */
export interface PluginSettingsPage {
  /** Unique within the plugin (namespaced to `<pluginId>:<id>` on register). */
  id: string
  /** Rail label and breadcrumb. */
  title: string
  /** Codicon name for the rail (e.g. `'cloud'`); a plug when omitted. */
  icon?: string
  /** Ascending; ties sort alphabetically by title. */
  order?: number
  /** The page's landing content. */
  render: () => ReactNode
  /** Sub-pages listed beneath the entry when it is selected. */
  children?: PluginSettingsSubpage[]
}



/** Options for a plugin REST call — mirrors the app's own `hermesDesktop.api`
 *  shape, minus the path (which is namespace-derived). */
export interface PluginRestOptions {
  method?: string
  body?: unknown
  /** Single-file multipart upload (see HermesApiRequest.upload). */
  upload?: { filename: string; contentType?: string; bytes: ArrayBuffer }
  timeoutMs?: number
}



// The built-in actions a plugin may run by id (`ctx.runAction`, see
// plugin-actions.ts): view / navigation only. Nothing destructive, nothing
// that switches profile / model, spawns a shell, or opens native dialogs.
export const PLUGIN_APP_ACTIONS = [
  // Panels and layout
  'view.showBrowser',
  'view.showFiles',
  'view.toggleSidebar',
  'view.toggleRightSidebar',
  'view.toggleReview',
  'view.toggleStatusbar',
  'view.findInPage',
  // Composer and chat
  'composer.focus',
  'session.new',
  'session.focusSearch',
  'conversation.scrollPageUp',
  'conversation.scrollPageDown',
  // Navigation
  'nav.commandPalette',
  'nav.settings',
  'nav.profiles',
  'nav.capabilities',
  'nav.messaging',
  'nav.artifacts',
  'nav.cron',
  'nav.agents',
  'keybinds.openPanel'
] as const



/** An app action id a plugin may run with `ctx.runAction`. */
export type PluginAppActionId = (typeof PLUGIN_APP_ACTIONS)[number]



/** One row of `ctx.listActions()`. */
export interface PluginAppActionInfo {
  id: PluginAppActionId
  /** The localized label the Keyboard Shortcuts panel shows. */
  label: string
  category: KeybindCategory
}



/** What `ctx.runAction` resolves to. It never throws. */
export type PluginRunActionResult =
  | { ok: true }
  | {
      ok: false
      /** `unknown`: no such action. `denied`: a real action that is not on
       *  the plugin allowlist. `unavailable`: the app shell that owns the
       *  handlers is not mounted (e.g. during early startup). */
      reason: 'denied' | 'unavailable' | 'unknown'
      error: string
    }



// -- the plugin door (`ctx.os.notify`) ----------------------------------------

export interface PluginNotificationAction {
  id: string
  label: string
  /** Navigate here on button press (path or `hermes://index-network/intent/1`). */
  activate?: HermesOpenTarget
  /** Renderer callback — only `id` crosses IPC; this stays in-process. */
  onAction?: () => void
}



export interface PluginNativeNotificationInput {
  title: string
  body?: string
  silent?: boolean
  /** Absolute filesystem path for the notification icon. */
  icon?: string
  /**
   * Where body-click should land. Accepts a plugin deep link
   * (`hermes://index-network/intent/1`), a hash path (`/index-network/intent/1`),
   * or `{ path, params }` — all resolve through the same helper as OS deep links.
   */
  activate?: HermesOpenTarget
  /** Extra work on body click (runs in addition to `activate` navigation). */
  onActivate?: () => void
  actions?: PluginNotificationAction[]
}



/**
 * Plugin lines for the pet's speech bubble — the store behind `ctx.pet.say`.
 *
 * A plugin hands the host a short plain-text line; the host owns where and
 * when it shows (the core `PetBubble`, in-window and in the pop-out overlay),
 * so no plugin ever has to locate the pet in the app DOM or float its own
 * overlay over it. Every line is:
 *
 *  - plain text: control characters stripped, whitespace collapsed, capped at
 *    `PET_MESSAGE_MAX_CHARS` (rendered as a React text node, never HTML);
 *  - attributed: it carries the plugin id and its display name, which the
 *    bubble prints as a small label;
 *  - short-lived: a TTL (default `PET_MESSAGE_DEFAULT_TTL_MS`, clamped) retires
 *    it, and the disposer `say` returns retires it early;
 *  - bounded: each plugin holds at most `PET_MESSAGE_MAX_PER_PLUGIN` live lines
 *    and gets `PET_MESSAGE_RATE_LIMIT` says per `PET_MESSAGE_RATE_WINDOW_MS`.
 *
 * The bubble shows the newest live line. The owning plugin's context clears
 * all of its lines when it unloads or is disabled.
 */

export type PetMessageTone = 'error' | 'info' | 'wait'



export interface PetSayOptions {
  /** Stable key within your plugin. Saying again with the same id replaces
   *  that line in place (a ticking counter, a refreshed balance). */
  id?: string
  /** Visual tone: `info` (default, no glyph), `wait` (clock), `error` (alert). */
  tone?: PetMessageTone
  /** How long the line stays up, in ms. Clamped to 1 s – 30 s; default 6 s. */
  ttlMs?: number
}

/**
 * Shared resolver for in-app navigation targets that must stay compatible with
 * `hermes://` deep links and `host.navigate('/path?…')`.
 *
 * Notification activation, deep-link delivery, and plugin `activate` payloads
 * all funnel through here so a toast click and an OS deep link land on the
 * same hash-router path.
 *
 * Supported deep-link shapes:
 *  - `hermes://index-network/intent/1` → `/index-network/intent/1` (plugin-scoped)
 *  - `hermes://open/my-page?item=x` → `/my-page?item=x` (generic open)
 *  - `/my-page?item=x` / `#/my-page?item=x` (hash-router paths)
 */

export type HermesOpenTarget = string | { href: string } | { path: string; params?: Record<string, string> }
