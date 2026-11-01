export const KANBAN_CARD_AREAS = { badges: 'kanban.card.badges' } as const

/** The badge palette: the app's twelve identity hues (`PROFILE_SWATCHES`), in
 *  hue order, so `KANBAN_CARD_BADGE_HUES[hash % 12]` spreads values evenly. */
export const KANBAN_CARD_BADGE_HUES = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'mint',
  'cyan',
  'sky',
  'blue',
  'violet',
  'magenta',
  'pink'
] as const

export type KanbanCardBadgeHue = (typeof KANBAN_CARD_BADGE_HUES)[number]
export type KanbanCardBadgeTone = 'neutral' | KanbanCardBadgeHue

/** What the host accepts per card. Over-long text is shortened, never refused;
 *  badges past a plugin's cap are dropped. */
export const KANBAN_CARD_BADGE_LIMITS = { labelChars: 24, perPlugin: 2, tooltipChars: 160 } as const

/** What a decorator gets to branch on: the card's identity and routing fields,
 *  never its prose (title, body, summaries, comments, run output). Frozen.
 *  Every field is a standing compatibility promise. */
export interface KanbanCard {
  readonly assignee: null | string
  /** The task id (`t_…`): the key to look up your own per-card data by. */
  readonly id: string
  /** The column the card is in (`triage`, `ready`, `running`, …). */
  readonly status: string
  readonly tenant: null | string
}

/** Board-level facts every card on the board shares. Frozen. */
export interface KanbanCardBoard {
  /** Every tenant on the board (the list its filter menu offers), so a plugin
   *  can give each one a distinct color instead of hashing blind. */
  readonly tenants: readonly string[]
}

export interface KanbanCardBadge {
  /** Plain text, shown as-is (no markup). Trimmed; control and bidi
   *  characters removed; shortened past `labelChars`. */
  label: string
  /** A palette hue, or `'neutral'` (the default; also what anything else
   *  becomes). */
  tone?: KanbanCardBadgeTone
  /** Plain-text hover line. The host always adds the plugin's name under it. */
  tooltip?: string
}

/** Payload of a `kanban.card.badges` data contribution. Return a badge, a few
 *  badges, or `null` for cards you have nothing to say about. Keep it a pure
 *  lookup: it runs while the board renders. */
export interface KanbanCardBadgeContribution {
  decorate: (
    card: KanbanCard,
    board: KanbanCardBoard
  ) => KanbanCardBadge | null | readonly KanbanCardBadge[] | undefined
}

