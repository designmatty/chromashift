import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface DisplayServicePathContext {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  cwd: string
  configuredPath?: string
}

export function displayServiceCandidates(context: DisplayServicePathContext): string[] {
  if (context.isPackaged) {
    return [join(context.resourcesPath, 'display-service', 'ChromaShift.DisplayService.exe')]
  }

  return [
    context.configuredPath,
    resolve(
      context.appPath,
      '..',
      '..',
      'native',
      'DisplayService',
      'bin',
      'Debug',
      'net10.0-windows',
      'ChromaShift.DisplayService.exe'
    ),
    resolve(
      context.cwd,
      'native',
      'DisplayService',
      'bin',
      'Debug',
      'net10.0-windows',
      'ChromaShift.DisplayService.exe'
    )
  ].filter((candidate): candidate is string => candidate !== undefined)
}

export function resolveDisplayServicePath(context: DisplayServicePathContext): string {
  const candidates = displayServiceCandidates(context)
  const executable = candidates.find(existsSync)
  if (executable === undefined) {
    throw new Error(`DisplayService executable not found. Checked: ${candidates.join(', ')}`)
  }
  return executable
}
