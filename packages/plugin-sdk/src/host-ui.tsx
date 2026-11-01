import { createElement } from 'react'
import { requireCapability, type MessageTextContentProps, type CapabilitiesViewProps, type ConnectorsTabProps, type ToolsetConfigPanelProps } from './services'

export function MessageTextContent(props: MessageTextContentProps) { return createElement(requireCapability('MessageTextContent'), props) }
export function CapabilitiesView(props: CapabilitiesViewProps) {
  const Component = requireCapability('CapabilitiesView')
  if (Component.supportsFixedConnection !== true) throw new Error('Host CapabilitiesView must support fixed connections')
  return createElement(Component, props)
}
CapabilitiesView.supportsFixedConnection = true as const
export function ConnectorsTab(props: ConnectorsTabProps) { return createElement(requireCapability('ConnectorsTab'), props) }
export function ToolsetConfigPanel(props: ToolsetConfigPanelProps) { return createElement(requireCapability('ToolsetConfigPanel'), props) }

export function KanbanCardBadges(props: { card: { assignee?: null | string; id: string; status: string; tenant?: null | string }; tenants: readonly string[] }) { return createElement(requireCapability('KanbanCardBadges'), props) }
export function WorkspacePageHeaderControl(props: { children: import('react').ReactNode; id: string }) { return createElement(requireCapability('WorkspacePageHeaderControl'), props) }
