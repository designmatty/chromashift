import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {
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
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer') }
    },
    plugins: [react(), tailwindcss()]
  }
})
