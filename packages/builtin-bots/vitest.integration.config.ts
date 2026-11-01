import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@hermes/plugin-sdk': fileURLToPath(new URL('../plugin-sdk/src/index.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['test/*.test.{ts,tsx}'], restoreMocks: true }
})
