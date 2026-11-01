import { atom } from 'nanostores'
import type { Contribution } from '../../plugin-sdk/src/contribution'
export function createRegistry() {
  const entries = new Map<string, Contribution>()
  const version = atom(0)
  const bump = () => version.set(version.get() + 1)
  return {
    version,
    register(contribution: Contribution) {
      const key = `${contribution.area}\0${contribution.id}`
      entries.set(key, contribution); bump()
      return () => { if (entries.get(key) === contribution) { entries.delete(key); bump() } }
    },
    areas() { return [...new Set([...entries.values()].map(c => c.area))].sort() },
    getArea(area: string) { return [...entries.values()].filter(c => c.area === area && c.enabled !== false && (!c.when || c.when())).sort((a,b) => (a.order ?? 0) - (b.order ?? 0)) }
  }
}
