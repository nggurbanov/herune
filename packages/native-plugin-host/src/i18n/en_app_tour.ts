// Extracted from apps/desktop/src/i18n/en_app_tour.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { Translations } from '../../../plugin-sdk/src/i18n/types'

export const enAppTour: Translations['appTour'] = {
  sessions: { title: 'Your chats', text: 'Every conversation lives here. Search, pin or reopen any of them.' },
  composer: { title: 'Ask here', text: 'Say what you want done. Type @ to bring in a file.' },
  newSession: { title: 'Start fresh', text: 'A new session gets its own context. Use one per job.' },
  model: { title: 'Model picker', text: 'Chooses which model answers you.' },
  modelLocal: 'This computer can run one locally: Settings > Providers > Local Models.',
  capabilities: { title: 'Capabilities', text: 'Skills, tools and plugins Hermes can use. Add more here.' },
  messaging: { title: 'Messaging', text: 'Reach Hermes from Telegram, Slack, Discord and more.' },
  rightPane: { title: 'The working pane', text: 'Opens files, terminal, review and the in-app browser on the right.' }
}
