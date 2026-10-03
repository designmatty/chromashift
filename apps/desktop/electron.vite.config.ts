import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { nodeAliases, rendererAliases } from './import-aliases.js'

export default defineConfig({
  main: {
    resolve: { alias: nodeAliases },
    build: {
      // The packaged app ships only compiled output. Bundle workspace and
      // third-party modules so Electron Builder does not copy node_modules.
      externalizeDeps: false
    }
  },
  preload: {
    resolve: { alias: nodeAliases },
    build: {
      // A sandboxed preload cannot resolve arbitrary node_modules at runtime.
      // Bundle the shared validation contracts and leave Electron external.
      externalizeDeps: false,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    build: {
      minify: 'esbuild'
    },
    resolve: {
      alias: rendererAliases
    },
    plugins: [react()]
  }
})
