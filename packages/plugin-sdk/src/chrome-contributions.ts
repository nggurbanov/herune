import type { ReactNode, MouseEvent } from 'react'
interface Tiered { tier?: 'advanced' | 'simple' }
export interface StatusbarMenuItem {
  id: string
  icon?: ReactNode
  label: string
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  onSelect?: () => void
  title?: string
  to?: string
}

export interface StatusbarItem {
  id: string
  /** Escape hatch: render an arbitrary node into the bar (own state, tooltip,
   *  events). When set, it OWNS the slot — label/variant/onSelect are ignored.
   *  This is how a plugin drops a full stateful React component into the bar. */
  render?: () => ReactNode
  label?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  menuAlign?: 'center' | 'end' | 'start'
  menuClassName?: string
  // A render fn receives a `close()` to dismiss the popover from inside the content.
  menuContent?: ((close: () => void) => ReactNode) | ReactNode
  menuItems?: readonly StatusbarMenuItem[]
  onSelect?: (modifiers: StatusbarSelectModifiers) => void
  /** Keybind action id — when set, the tooltip shows the label + keybind hint. */
  actionId?: string
  title?: string
  to?: string
  variant?: 'action' | 'link' | 'menu' | 'text'
  /** Plain-text name for the bar's right-click show/hide menu. An item without
   *  one is never listed there and always shows — the safe default for plugin
   *  contributions that don't opt in. */
  toggleLabel?: string
  /** Listed in the menu but not switchable: the bar's own affordances (command
   *  center, update/version pills) would strand the user if they could be
   *  hidden from the surface that hides them. */
  lockedVisible?: boolean
}

export interface StatusbarSelectModifiers {
  shiftKey: boolean
}
export interface TitlebarTool extends Tiered {
  id: string
  label: string
  active?: boolean
  expanded?: boolean
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  icon: ReactNode
  onSelect?: (event?: MouseEvent) => void
  /** Keybind action id — when set, the tooltip shows the label + keybind hint. */
  actionId?: string
  /** Overlay count on the glyph (unread sessions). Hidden when 0/undefined. */
  badge?: number
  title?: string
  to?: string
  /** Durable `data-tour` handle. Tools are addressed by icon and translated
   *  label otherwise, and neither survives a theme or a locale change. */
  tour?: string
}
