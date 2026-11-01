import { createElement } from 'react'
import type { SessionInfo } from '../session-info'
import { requireCapability } from '../services'
/** The host owns session-state reduction and supplies its canonical status renderer. */
export interface SessionStatusDotProps {
  storedSessionId: null | string
  session?: null | SessionInfo
  branchStem?: string
  className?: string
}
export function SessionStatusDot(props: SessionStatusDotProps) {
  return createElement(requireCapability('SessionStatusDot'), props)
}
