import type { ActivationArguments } from 'electron'

export interface NotificationTarget {
  id: string
  profileId: string | null
}

// Use Electron's structured action format for the body as well as Close. The
// Windows WinRT path drops the arguments for ordinary clicks; structured actions
// reach handleActivation even while the original Notification is still alive.
export function notificationActivationArguments(
  target: NotificationTarget,
  action: 'close' | 'body'
): string {
  return new URLSearchParams({
    type: 'action',
    action: action === 'close' ? '0' : '1',
    tag: target.id,
    chromashift: 'notification-v1',
    profile: target.profileId ?? ''
  }).toString()
}

function parseActivation(
  details: ActivationArguments
): (NotificationTarget & { action: 'close' | 'body' }) | null {
  const args = new URLSearchParams(details.arguments)
  const keys = ['type', 'action', 'tag', 'chromashift', 'profile']
  if (
    details.type !== 'action' ||
    args.size !== keys.length ||
    keys.some((key) => args.getAll(key).length !== 1) ||
    args.get('chromashift') !== 'notification-v1' ||
    args.get('type') !== 'action'
  )
    return null
  const id = args.get('tag')!
  const action = args.get('action')
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id) ||
    (action !== '0' && action !== '1') ||
    details.actionIndex !== Number(action)
  )
    return null
  return { id, profileId: args.get('profile') || null, action: action === '0' ? 'close' : 'body' }
}

export function isWindowsNotificationLaunch(
  platform: NodeJS.Platform,
  argv: readonly string[]
): boolean {
  // LocalServer32 COM activation appends -Embedding, not the toast arguments.
  // Those arrive separately through Notification.handleActivation.
  return platform === 'win32' && argv.some((arg) => /^[-/]embedding$/iu.test(arg))
}

export function handleSecondInstanceLaunch(
  platform: NodeJS.Platform,
  argv: readonly string[],
  openWindow: () => void
): void {
  if (!isWindowsNotificationLaunch(platform, argv)) openWindow()
}

export class NotificationActivationController {
  readonly #handled = new Set<string>()
  readonly #pending: Array<string | null> = []
  #ready = false
  #startupAllowed: boolean | undefined
  #startupWait: Promise<boolean> | undefined
  #resolveStartup: ((allowed: boolean) => void) | undefined

  public constructor(
    private readonly openProfile: (profileId: string | null) => void,
    private readonly dismiss: (id: string) => void,
    private readonly notificationLaunch = false
  ) {}

  public waitForStartup(): Promise<boolean> {
    if (!this.notificationLaunch) return Promise.resolve(true)
    if (this.#startupAllowed !== undefined) return Promise.resolve(this.#startupAllowed)
    this.#startupWait ??= new Promise((resolve) => {
      // Start only after the shell has registered the COM callback. Three
      // seconds allows delayed delivery without leaving an idle tray process
      // alive indefinitely when Windows sends no recognizable activation.
      const timeout = setTimeout(() => this.#settleStartup(false), 3_000)
      this.#resolveStartup = (allowed) => {
        clearTimeout(timeout)
        resolve(allowed)
      }
    })
    return this.#startupWait
  }

  public handle(details: ActivationArguments): void {
    if (this.notificationLaunch && this.#startupAllowed === false) return
    const activation = parseActivation(details)
    if (activation === null || this.#handled.has(activation.id)) return
    this.#handled.add(activation.id)
    // Bound duplicate tracking across long tray sessions. Electron can deliver
    // both the global callback and the instance event for one activation.
    if (this.#handled.size > 256) this.#handled.delete(this.#handled.values().next().value!)
    this.dismiss(activation.id)
    // Remember the first recognized activation even if Electron replays it
    // synchronously during callback registration, before waitForStartup.
    if (this.notificationLaunch) this.#settleStartup(activation.action === 'body')
    if (activation.action === 'close') return
    if (this.#ready) this.openProfile(activation.profileId)
    else this.#pending.push(activation.profileId)
  }

  public ready(): void {
    if (this.notificationLaunch && this.#startupAllowed !== true) return
    this.#ready = true
    for (const profileId of this.#pending.splice(0)) this.openProfile(profileId)
  }

  #settleStartup(allowed: boolean): void {
    if (this.#startupAllowed !== undefined) return
    this.#startupAllowed = allowed
    this.#resolveStartup?.(allowed)
    this.#resolveStartup = undefined
  }
}
