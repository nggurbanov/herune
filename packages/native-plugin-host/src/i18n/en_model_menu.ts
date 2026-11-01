// Extracted from apps/desktop/src/i18n/en_model_menu.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { Translations } from '../../../plugin-sdk/src/i18n/types'

export const enModelMenu: Translations['shell']['modelMenu'] = {
  pickDeferred: (model: string) => `${model} applies from your next message`,
  search: 'Search models',
  noModels: 'No models found',
  editModels: 'Edit models…',
  followDefault: 'Use Settings default',
  refreshModels: 'Refresh models',
  favorites: 'Favorites',
  addFavorite: 'Add to favorites',
  removeFavorite: 'Remove from favorites',
  favoriteShortcut: '⇧ Click',
  fast: 'Fast',
  free: 'free',
  cacheRead: 'cached read',
  priceTitle: (input: string, output: string, cache: string) =>
    `Input ${input}/Mtok · Output ${output}/Mtok` + (cache ? ` · Cached read ${cache}/Mtok` : ''),
  localSetup: {
    title: 'Run locally · free, private',
    text: (model: string, size: string) => `${model} fits this machine · ${size} download`,
    action: 'Set up'
  },
  limited: 'Limited',
  limitedUntil: (time: string) => `Limited until ${time}`,
  limitedTip: (provider: string, time: null | string) =>
    time
      ? `${provider} hit its usage limit. It resets at ${time}; you can still pick a model for after.`
      : `${provider} hit its usage limit. You can still pick a model for after it resets.`,
  modelResets: (time: string) => `resets ${time}`,
  modelLimitedTip: (time: string) =>
    `This model hit its own limit and resets at ${time}. Other models here still work.`,
  usageLeft: (percent: number, time: null | string) =>
    time ? `${percent}% left · resets ${time}` : `${percent}% left`,
  poolAccounts: (count: number) => `${count} ${count === 1 ? 'account' : 'accounts'}`,
  poolLimited: (limited: number, total: number) => `${limited}/${total} accounts limited`,
  poolAccount: (number: number) => `Account ${number}`,
  poolUnknown: 'Usage unavailable',
  poolUnavailable: 'Sign in again',
  usageTip: (provider: string) => `${provider} is close to its usage limit.`,
  usageWindow: (label: string, percent: number, time: null | string) =>
    time ? `${label}: ${percent}% left, resets ${time}` : `${label}: ${percent}% left`
}
