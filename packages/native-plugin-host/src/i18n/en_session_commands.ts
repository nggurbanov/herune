// Extracted from apps/desktop/src/i18n/en_session_commands.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { SessionCommandNotices } from '../../../plugin-sdk/src/i18n/types_notices'

// Typed /undo /retry /steer /queue lines: the Ink TUI's wording on the same gateway.
export const enSessionCommands: SessionCommandNotices = {
  undoUsage: 'usage: /undo [N]',
  undoNothing: 'nothing to undo',
  undidOne: (count: string) => `undid ${count} message — the removed message is in the composer`,
  undidOther: (count: string) => `undid ${count} messages — the removed message is in the composer`,
  retryNothing: 'nothing to retry',
  retryUnsupported: '/retry: retry does not support media or unknown content parts',
  busy: (command: string) =>
    `session busy — Hermes is still replying. Stop the current reply first (Stop button, or Ctrl+C in a terminal), then run /${command}.`,
  busyCompressing: (command: string) =>
    `session busy — a /compress is running; run /${command} when it finishes.`,
  steerUsage: 'usage: /steer <prompt>',
  steerQueued: (preview: string) => `steer queued — arrives after next tool call: "${preview}"`,
  steerNoActiveTurn: (preview: string) => `no active turn — queued for next: "${preview}"`,
  steerRejected: 'steer rejected — no active turn, queued for next turn',
  queued: (preview: string) => `queued: "${preview}"`,
  queueFailed: 'could not queue the message',
  countOne: (count: string) => `${count} queued message`,
  countOther: (count: string) => `${count} queued messages`,
  queueEditKeptTitle: 'Queued message not changed',
  queueEditKept: 'It started or was refused before your edit was saved. Your edited text is in the composer.',
  queueEditUnconfirmedTitle: 'Edit not confirmed',
  queueEditUnconfirmed:
    'Hermes could not confirm your edit. Save again to retry the same edit; it is never queued twice.'
}
