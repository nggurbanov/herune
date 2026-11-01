import { atom } from 'nanostores'
import type { createStorage } from './storage'
export const DECISIONS_KEY = 'hermes.desktop.pluginDecisions.v2'
export function createDecisions(storage: ReturnType<typeof createStorage>) {
  const raw = storage.readKey(DECISIONS_KEY), legacy = storage.readKey('hermes.desktop.disabledPlugins.v1')
  let choices: Record<string, boolean> = {}
  try { if (raw) choices = JSON.parse(raw); else if (legacy) choices = Object.fromEntries((JSON.parse(legacy) as string[]).map(id => [id, false])) } catch { throw new Error('Saved plugin decisions are invalid') }
  if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.values(choices).some(value => typeof value !== 'boolean')) throw new Error('Saved plugin decisions are invalid')
  return atom(choices)
}
