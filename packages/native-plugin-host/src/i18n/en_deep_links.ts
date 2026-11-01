// Extracted from apps/desktop/src/i18n/en_deep_links.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { GatewayGroupOpenCopy, SkillDeepLinkCopy } from '../../../plugin-sdk/src/i18n/types_deep_links'

export const enSkillDeepLink: SkillDeepLinkCopy = {
  installTitle: (name: string) => `Install “${name}”?`,
  installDescription: 'This skill will be available in new sessions. Only install sources you trust.',
  installTo: 'Install to',
  thisComputer: 'This computer',
  installing: 'Installing…',
  installComplete: (name: string) => `“${name}” installed`,
  destinationChanged: 'The destination changed. Close this dialog and open the install link again.',
  installed: 'Installed',
  source: 'Source'
}

export const enGatewayGroupOpen: GatewayGroupOpenCopy = {
  opening: 'Opening gateway group…',
  lookupFailed: 'Could not look up this group on the gateway. Try again.',
  missing: 'This gateway group no longer exists.'
}
