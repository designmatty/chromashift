import type { ChromaShiftApi } from '../shared/product-api.js'

declare global {
  interface Window {
    chromaShift: ChromaShiftApi
  }
}

export {}
