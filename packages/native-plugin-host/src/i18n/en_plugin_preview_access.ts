// Extracted from apps/desktop/src/i18n/en_plugin_preview_access.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { PluginPreviewAccessTranslations } from '../../../plugin-sdk/src/i18n/types_plugin_preview_access'

/** Copy for the preview-script consent prompt and the per-plugin grant list (Capabilities ▸ Plugins). */
export const enPluginPreviewAccess: PluginPreviewAccessTranslations = {
  previewScriptPromptTitle: (plugin: string) => `Let ${plugin} run scripts on this page?`,
  previewScriptPromptBody: (plugin: string, origin: string) =>
    `${plugin} wants to run JavaScript in the preview Browser on ${origin}.`,
  previewScriptPromptRisk: 'Scripts can read and change everything on that site, including pages from accounts you are signed in to there.',
  previewScriptPromptRevokeHint: 'Applies to this site only. You can revoke it in Capabilities ▸ Plugins.',
  previewScriptAllow: 'Allow on this site',
  previewScriptDeny: "Don't allow",
  previewScriptAccessLabel: 'Page scripts',
  previewScriptAccessNone: 'Asks before running scripts on a page',
  previewScriptRevoke: (origin: string) => `Revoke access to ${origin}`,
  previewScriptRevoked: (plugin: string, origin: string) => `${plugin} can no longer run scripts on ${origin}.`,
  previewScriptRevokeUnsaved: (plugin: string, origin: string) =>
    `Couldn't save that change, so it lasts only until Hermes restarts. ${plugin} is blocked on ${origin} for now.`
}
