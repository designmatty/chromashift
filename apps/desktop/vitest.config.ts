import { defineConfig } from 'vitest/config'
import { nodeAliases, rendererAliases } from './import-aliases.js'

export default defineConfig({
  resolve: {
    alias: { ...nodeAliases, ...rendererAliases }
  }
})
