/** Owner-limited status projection using the native snapshot's live busy flag.
 * Baseline appearance adapted from Desktop session-status-dot.tsx (MIT). */
import { useStore } from '@nanostores/react'
import type { PluginHostState } from '../../plugin-sdk/src/host-types'
import type { SessionStatusDotProps } from '../../plugin-sdk/src/ui/session-status-dot'
export function makeSessionStatusDot(state: PluginHostState) {
  return function SessionStatusDot({storedSessionId,branchStem,className}:SessionStatusDotProps) {
    const selected=useStore(state.focusedStoredSessionId), busy=useStore(state.busy)
    const working=Boolean(storedSessionId && storedSessionId===selected && busy)
    const draft=!storedSessionId
    return <span className={`flex items-center gap-0.5 ${className ?? ''}`}>{branchStem && <span aria-hidden="true">{branchStem}</span>}<span role="status" aria-label={working?'Session running':draft?'Draft session':'Session status unavailable'} className={working?'size-1.5 rounded-full bg-(--ui-accent)':'size-1.5 rounded-full border border-(--ui-text-quaternary)'} /></span>
  }
}
