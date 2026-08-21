import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const unusedGpuRuntimeFiles = [
  'dxcompiler.dll',
  'dxil.dll',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll'
]

export default async function pruneElectronRuntime(context) {
  if (context.electronPlatformName !== 'win32') return

  await Promise.all(
    unusedGpuRuntimeFiles.map((file) => rm(join(context.appOutDir, file), { force: true }))
  )
}
