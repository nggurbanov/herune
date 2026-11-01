// Extracted from apps/desktop/src/i18n/en_external_open.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { ExternalOpenFailedCopy } from '../../../plugin-sdk/src/i18n/types_external_open'

export const enExternalOpenFailed: ExternalOpenFailedCopy = {
  title: 'Couldn’t open this link',
  message: 'No browser is registered to open this address. Copy the link and open it manually.',
  copyUrl: 'Copy link',
  close: 'Close',
  missing: {
    title: 'File not found',
    message: 'This file does not exist — it may have been deleted or moved, or it lives on another machine.'
  }
}
