import { Button, Contribute, host, type PluginProfileRoute } from '@hermes/plugin-sdk'
const route: PluginProfileRoute = { connectionId: 'source-a', mode: 'remote', profile: 'bot', targetProfile: 'bot' }
void host.requestProfile(route, 'session.list', { title: 'Bot Chat' })
export const widget = <Contribute area="titleBar.left" id="sample:action"><Button onClick={() => host.navigate('/settings')}>Settings</Button></Contribute>
import { type DesktopSettingValues, type ViewportRect, type ComposerMiddleware, type ToolMediaRendererContribution, type SidebarNavContribution, reasoningEffortLabel } from '@hermes/plugin-sdk'
const density: DesktopSettingValues['sessionListDensity'] = host.settings.get('sessionListDensity')
host.settings.set('chatTextScale', 125)
host.settings.subscribe('backdrop.v1', value => { const enabled: boolean = value; void enabled })
host.sessions.pin('durable', false, 0)
void host.composer.insertText('id', 'text', { mode: 'inline' })
void host.skills.list({ connectionId: 'source-a', profile: 'bot' })
void host.toolsets.setEnabled('web', true, 'bot')
void host.profiles.list({ connectionId: 'source-a' })
void host.spellcheck.addWord('Hermes')
const rect: ViewportRect = host.state.viewport.get()
const middleware: ComposerMiddleware = { handler: draft => ({ ...draft, text: draft.text.trim() }) }
const media: ToolMediaRendererContribution = { tools: ['example'], render: ({ fallback }) => fallback }
const nav: SidebarNavContribution = { label: 'Example', codicon: 'plug', path: '/example' }
void [density, rect, middleware, media, nav, reasoningEffortLabel('ultra', 'max')]
