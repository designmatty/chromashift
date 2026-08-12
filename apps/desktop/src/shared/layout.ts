/**
 * Pure geometry contracts shared by the main process (window sizing) and the
 * renderer (sidebar sizing and narrow-window overflow). Keeping these as plain
 * functions lets the supported minimum window size be tested without Electron.
 */

export const MIN_WINDOW_WIDTH = 880
export const MIN_WINDOW_HEIGHT = 600
export const DEFAULT_WINDOW_WIDTH = 1044
export const DEFAULT_WINDOW_HEIGHT = 629

export const MIN_SIDEBAR_WIDTH = 190
export const MAX_SIDEBAR_WIDTH = 360
export const DEFAULT_SIDEBAR_WIDTH = 246
/** The profile editor stops being usable below this, so the sidebar yields first. */
export const MIN_EDITOR_WIDTH = 520

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

/**
 * The sidebar keeps its persisted width until the editor would drop below its
 * minimum, then shrinks, and never goes under its own minimum.
 */
export function resolveSidebarWidth(persistedWidth: number, windowWidth: number): number {
  const requested = Number.isFinite(persistedWidth) ? persistedWidth : DEFAULT_SIDEBAR_WIDTH
  const available = windowWidth - MIN_EDITOR_WIDTH
  const ceiling = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, available))
  return Math.round(clamp(requested, MIN_SIDEBAR_WIDTH, ceiling))
}

/**
 * Below this the sidebar and editor cannot both meet their minimums, so the
 * shell stacks them and the editor scrolls instead of clipping.
 */
export function shouldStackPanels(windowWidth: number): boolean {
  return windowWidth < MIN_SIDEBAR_WIDTH + MIN_EDITOR_WIDTH
}

function intersectionArea(bounds: WindowBounds, area: WorkArea): number {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const height =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  return width <= 0 || height <= 0 ? 0 : width * height
}

export function isOnAnyWorkArea(bounds: WindowBounds, workAreas: readonly WorkArea[]): boolean {
  return workAreas.some((area) => intersectionArea(bounds, area) > 0)
}

function centerOn(area: WorkArea, width: number, height: number): WindowBounds {
  const clampedWidth = Math.min(width, area.width)
  const clampedHeight = Math.min(height, area.height)
  return {
    x: Math.round(area.x + (area.width - clampedWidth) / 2),
    y: Math.round(area.y + (area.height - clampedHeight) / 2),
    width: clampedWidth,
    height: clampedHeight
  }
}

/**
 * Restores saved window geometry, enforcing the supported minimum size and
 * recentering on the primary work area when the saved position no longer
 * intersects a connected display.
 */
export function resolveWindowBounds(
  saved: WindowBounds | undefined,
  workAreas: readonly WorkArea[]
): WindowBounds {
  const primary = workAreas[0]
  if (saved === undefined || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return primary === undefined
      ? { x: 0, y: 0, width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }
      : centerOn(primary, DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
  }

  const sized: WindowBounds = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.round(Math.max(saved.width, MIN_WINDOW_WIDTH)),
    height: Math.round(Math.max(saved.height, MIN_WINDOW_HEIGHT))
  }
  if (workAreas.length === 0 || isOnAnyWorkArea(sized, workAreas)) return sized
  return primary === undefined ? sized : centerOn(primary, sized.width, sized.height)
}
