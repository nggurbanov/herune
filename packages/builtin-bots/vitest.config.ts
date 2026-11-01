import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@hermes/plugin-sdk': fileURLToPath(new URL('./test/sdk-stub.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['src/*.test.{ts,tsx}'], restoreMocks: true }
})
