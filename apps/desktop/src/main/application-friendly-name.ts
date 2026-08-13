import { basename, extname } from 'node:path'

const windowTitleSeparator = /\s+[-–—]\s+/

export function applicationFriendlyName(title: string, executablePath: string): string {
  const titleParts = title
    .split(windowTitleSeparator)
    .map((part) => part.trim())
    .filter(Boolean)

  return titleParts.at(-1) ?? basename(executablePath, extname(executablePath))
}
