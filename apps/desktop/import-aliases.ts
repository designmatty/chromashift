import { resolve } from 'node:path'

export const nodeAliases = {
  '@': resolve(import.meta.dirname, 'src/renderer'),
  '@main': resolve(import.meta.dirname, 'src/main'),
  '@preload': resolve(import.meta.dirname, 'src/preload'),
  '@shared': resolve(import.meta.dirname, 'src/shared')
}

export const rendererAliases = {
  '@': resolve(import.meta.dirname, 'src/renderer'),
  '@shared': nodeAliases['@shared']
}
