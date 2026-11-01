// Extracted from apps/desktop/src/i18n/en_clarify.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { ClarifyCopy } from '../../../plugin-sdk/src/i18n/types_clarify'

export const enClarify: ClarifyCopy = {
  notReady: 'Clarify request is not ready yet',
  gatewayDisconnected: 'Hermes is offline right now. Reconnect, then send it again.',
  sendFailed: 'Could not send clarify response',
  loadingQuestion: 'Loading question…',
  other: 'Other (type your answer)',
  placeholder: 'Type your answer…',
  skip: 'Skip',
  skipped: 'Skipped',
  noAnswer: 'No answer',
  confirmAndContinueLabel: 'Confirm and continue',
  singleSelectHint: 'Pick one',
  multiSelectHint: 'Select all that apply',
  oneQuestion: '1 question',
  questionProgress: (answered, total) => `${answered} of ${total} answered`,
  notDelivered:
    "This question didn't reach the app, so it can't be answered here. Press Stop to end the turn, then reply in chat."
}
