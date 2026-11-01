interface ComposerAttachment {
  id: string; occurrenceId?: string; kind: 'file' | 'folder' | 'image' | 'terminal' | 'url'; label: string
  detail?: string; refText?: string; previewUrl?: string; thumbnailUrl?: string; path?: string
  stagedUpload?: { install_id: string; path: string; profile_home: string }; mime?: string; titlePreview?: string
  attachedSessionId?: string; uploadState?: 'uploading' | 'error'
}

/** What a `composer.contextMenu` provider sees when the user right-clicks the
 *  composer: the word under the caret and the selection INSIDE the composer,
 *  nothing else — no element, no range, no other field's text. Every field
 *  is a standing compatibility promise to the plugins reading it. */
export interface ComposerContextMenuContext {
  /** Selected composer text at the click ('' when the caret is collapsed). */
  readonly selection: string
  /** The word under the caret (or at the selection's start), or null. */
  readonly word: null | string
}

/** Handed to an item's `onSelect` after the menu has closed and the composer
 *  has the caret back. */
export interface ComposerContextMenuAction extends ComposerContextMenuContext {
  /** Replace the right-clicked `word` with `text` (one line). Works once, and
   *  only while the composer still holds that word where it was — false
   *  otherwise, never an edit somewhere else. */
  replaceWord: (text: string) => boolean
}

/** One row the app renders for a plugin in the composer's context menu. */
export interface ComposerContextMenuItem {
  /** Plain text; control characters are stripped and it is clamped. */
  label: string
  disabled?: boolean
  onSelect: (action: ComposerContextMenuAction) => void
}

/** Payload of a `composer.contextMenu` data contribution. `items` runs once
 *  per right-click on the composer; return `[]` for "nothing from me". The
 *  app renders each plugin's rows as its own section (plugins ordered by id,
 *  at most six rows each) between its own spell-check rows and the edit verbs. */
export interface ComposerContextMenuProvider {
  items: (context: ComposerContextMenuContext) => ComposerContextMenuItem[]
}

export interface ComposerDraft {
  text: string
  attachments?: ComposerAttachment[]
}

/** Payload of a `composer.middleware` data contribution. */
export interface ComposerMiddleware {
  /** Rewrite (return a draft), pass through (same draft), or cancel (null). */
  handler: (draft: ComposerDraft) => ComposerDraft | null | Promise<ComposerDraft | null>
}

/** One row a `composer.atCompletions` source offers for the current query. */
export interface ComposerAtCompletionItem {
  /** Text inserted into the draft when picked (e.g. `@researcher`). */
  insert: string
  /** Row label; defaults to `insert`. */
  display?: string
  /** Secondary line (e.g. "Bot · Homelab"). */
  meta?: string
  /** Icon slug understood by the completion popover; defaults to 'simple'. */
  icon?: string
  /** Other `@handle` texts that resolve to the SAME target as `insert` —
   *  e.g. a bot's raw profile name alongside the title slug it is listed
   *  under. The `@` popover drops a gateway row whose handle is claimed
   *  here, so one routable identity is never offered twice under two
   *  labels. Only claim handles this row really owns. */
  handles?: string[]
}

/** Payload of a `composer.atCompletions` data contribution — an extra source
 *  merged into the composer's `@` popover ABOVE the path/reference results.
 *  `query` is the text typed after `@` (no leading `@`). Sources must be
 *  fast and synchronous-ish (called per keystroke after the debounce); slow
 *  lookups belong behind the source's own cache. */
export interface ComposerAtCompletionSource {
  provide: (query: string) => ComposerAtCompletionItem[]
}

export interface ComposerAttachmentContext {
  insertText: (text: string) => void
}

/** Payload of a `composer.attachments` data contribution — an entry in the
 *  composer's "+" attach menu. */
export interface ComposerAttachmentProvider {
  label: string
  /** Codicon name for the menu row. Defaults to `plug`. */
  icon?: string
  run: (ctx: ComposerAttachmentContext) => void | Promise<void>
}
/** What a model-pill label provider gets to branch on. Deliberately small:
 *  every field here is a standing compatibility promise to the plugins using it. */
export interface ComposerModelPillContext {
  /** The model slug the pill would show. */
  model: string
  /** The session's live reasoning effort ('' when the model has none). */
  reasoningEffort: string
  /** Floating-composer mode renders only the chevron; providers are not consulted. */
  compact: boolean
}

/** Payload of a `composer.modelPill` data contribution — the pill's label text.
 *  Return the label to show, or `null` to let the next provider (then the core
 *  label) win. The pill keeps its chrome and menu; only the label changes. */
export interface ComposerModelPillProvider {
  label: (ctx: ComposerModelPillContext) => null | string
}

