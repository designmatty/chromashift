import type { ActivationArguments } from 'electron'
import type { StructuredLogger } from '@main/structured-logger.js'

export type NotificationStartupDecision =
  { action: 'start' } | { action: 'quit'; reason: 'close' | 'timeout' }

interface NotificationStartupPorts {
  initialize(): void
  wait(): Promise<NotificationStartupDecision>
  quit(): void
  loadAndStart(): Promise<void>
  ready(): void
  shouldOpenWindow(): boolean
  openWindow(): void
  logger: StructuredLogger
}

export async function startAfterNotificationActivation(
  ports: NotificationStartupPorts
): Promise<void> {
  ports.initialize()
  const decision = await ports.wait()
  if (decision.action === 'quit') {
    ports.logger.write({
      level: 'information',
      eventName: 'NotificationLaunchQuit',
      reason: decision.reason
    })
    ports.quit()
    return
  }
  await ports.loadAndStart()
  ports.ready()
  if (ports.shouldOpenWindow()) ports.openWindow()
}

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
  requestLaunch: () => void
): void {
  if (!isWindowsNotificationLaunch(platform, argv)) requestLaunch()
}

export class NotificationActivationController {
  readonly #handled = new Set<string>()
  readonly #pending: Array<string | null> = []
  #ready = false
  #startupDecision: NotificationStartupDecision | undefined
  #startupWait: Promise<NotificationStartupDecision> | undefined
  #resolveStartup: ((decision: NotificationStartupDecision) => void) | undefined
  #relaunchRequested = false

  public constructor(
    private readonly openProfile: (profileId: string | null) => void,
    private readonly dismiss: (id: string) => void,
    private readonly notificationLaunch = false
  ) {}

  public waitForStartup(): Promise<NotificationStartupDecision> {
    if (!this.notificationLaunch) return Promise.resolve({ action: 'start' })
    if (this.#startupDecision !== undefined) return Promise.resolve(this.#startupDecision)
    this.#startupWait ??= new Promise((resolve) => {
      // Start only after the shell has registered the COM callback. Three
      // seconds allows delayed delivery without leaving an idle tray process
      // alive indefinitely when Windows sends no recognizable activation.
      const timeout = setTimeout(
        () => this.#settleStartup({ action: 'quit', reason: 'timeout' }),
        3_000
      )
      this.#resolveStartup = (decision) => {
        clearTimeout(timeout)
        resolve(decision)
      }
    })
    return this.#startupWait
  }

  public requestLaunch(relaunch: () => void): void {
    if (this.#startupDecision?.action === 'quit') {
      // The startup continuation is already committed to quit. Preserve the
      // explicit launch in a new process instead of reviving a settled gate.
      if (!this.#relaunchRequested) {
        this.#relaunchRequested = true
        relaunch()
      }
      return
    }
    this.#settleStartup({ action: 'start' })
    if (this.#ready) this.openProfile(null)
    else this.#pending.push(null)
  }

  public handle(details: ActivationArguments): void {
    if (this.notificationLaunch && this.#startupDecision?.action === 'quit') return
    const activation = parseActivation(details)
    if (activation === null || this.#handled.has(activation.id)) return
    this.#handled.add(activation.id)
    // Bound duplicate tracking across long tray sessions. Electron can deliver
    // both the global callback and the instance event for one activation.
    if (this.#handled.size > 256) this.#handled.delete(this.#handled.values().next().value!)
    this.dismiss(activation.id)
    // Remember the first recognized activation even if Electron replays it
    // synchronously during callback registration, before waitForStartup.
    if (this.notificationLaunch)
      this.#settleStartup(
        activation.action === 'body' ? { action: 'start' } : { action: 'quit', reason: 'close' }
      )
    if (activation.action === 'close') return
    if (this.#ready) this.openProfile(activation.profileId)
    else this.#pending.push(activation.profileId)
  }

  public ready(): void {
    if (this.notificationLaunch && this.#startupDecision?.action !== 'start') return
    this.#ready = true
    for (const profileId of this.#pending.splice(0)) this.openProfile(profileId)
  }

  #settleStartup(decision: NotificationStartupDecision): void {
    if (this.#startupDecision !== undefined) return
    this.#startupDecision = decision
    this.#resolveStartup?.(decision)
    this.#resolveStartup = undefined
  }
}
