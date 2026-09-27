import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { analyticsBeaconAttributes, headersFile, resolveDeployment } from './deployment'

function deploymentPlugin(): Plugin {
  const deployment = resolveDeployment(process.env)
  return {
    name: 'chromashift-deployment',
    apply: 'build',
    transformIndexHtml() {
      if (deployment.analyticsToken === undefined) return []
      return [
        {
          tag: 'script',
          attrs: analyticsBeaconAttributes(deployment.analyticsToken),
          injectTo: 'body'
        }
      ]
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: headersFile(deployment.channel)
      })
    }
  }
}

export default defineConfig({
  appType: 'mpa',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        notFound: resolve(import.meta.dirname, '404.html')
      }
    }
  },
  plugins: [deploymentPlugin()]
})
