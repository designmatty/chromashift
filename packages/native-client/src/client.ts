import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import {
  nativeMessageSchema,
  nativeResponseSchema,
  baselineCaptureResultSchema,
  displayApplyRequestSchema,
  displayApplyResultSchema,
  displayRequestSchema,
  displayRestoreResultSchema,
  displaySettingsSchema,
  displayStateSchema,
  foregroundCurrentResultSchema,
  foregroundApplicationsResultSchema,
  displayListResultSchema,
  displayCapabilitiesResultSchema,
  restoreAllResultSchema,
  systemInfoSchema,
  type BaselineCaptureResult,
  type DisplayApplyResult,
  type NativeEvent,
  type ForegroundApplication,
  type Display,
  type DisplayCapabilities,
  type DisplayCapabilityReport,
  type DisplayRestoreResult,
  type DisplaySettings,
  type DisplayState,
  type NativeResponse,
  type RestoreAllResult,
  type SystemInfo
} from './protocol.js'

interface PendingRequest {
  resolve: (response: NativeResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export interface NativeClientOptions {
  executablePath: string
  executableArguments?: readonly string[]
  requestTimeoutMs?: number
  startupTimeoutMs?: number
}

interface ResolvedNativeClientOptions {
  executablePath: string
  executableArguments: readonly string[]
  requestTimeoutMs: number
  startupTimeoutMs: number
}

export interface NativeClientEvents {
  event: [event: NativeEvent]
  diagnostic: [message: string]
  failure: [error: Error]
  exit: [code: number | null, signal: NodeJS.Signals | null]
}

export class NativeServiceError extends Error {
  readonly code: string
  readonly command: string
  readonly requestId: string
  readonly nativeMessage: string

  constructor(code: string, message: string, command: string, requestId: string) {
    super(`${code}: ${message}`)
    this.name = 'NativeServiceError'
    this.code = code
    this.command = command
    this.requestId = requestId
    this.nativeMessage = message
  }
}

export class NativeClient extends EventEmitter<NativeClientEvents> {
  readonly #options: ResolvedNativeClientOptions
  readonly #pending = new Map<string, PendingRequest>()
  #process?: ChildProcessWithoutNullStreams
  #lines?: Interface
  #readyAnnounced = false
  #startupError?: Error

  constructor(options: NativeClientOptions) {
    super()
    this.#options = {
      executableArguments: [],
      requestTimeoutMs: 5_000,
      startupTimeoutMs: 10_000,
      ...options
    }
  }

  get running(): boolean {
    return this.#process !== undefined && this.#process.exitCode === null
  }

  async start(): Promise<SystemInfo> {
    if (this.running) {
      return this.getSystemInfo()
    }

    const child = spawn(this.#options.executablePath, [...this.#options.executableArguments], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.#process = child
    this.#readyAnnounced = false
    this.#startupError = undefined
    this.#lines = createInterface({ input: child.stdout })
    this.#lines.on('line', (line) => this.#handleLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => this.emit('diagnostic', chunk.trimEnd()))
    child.once('error', (error) => {
      this.#startupError = error
      this.#fail(error)
      this.emit('failure', error)
    })
    child.once('exit', (code, signal) => {
      this.#fail(new Error(`DisplayService exited (code=${String(code)}, signal=${String(signal)})`))
      this.emit('exit', code, signal)
    })

    try {
      await this.#waitForReady()
      return await this.getSystemInfo()
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error))
      if (child.exitCode === null && !child.killed) child.kill()
      this.#fail(startupError)
      throw startupError
    }
  }

  async getSystemInfo(): Promise<SystemInfo> {
    return systemInfoSchema.parse(await this.request('system.info'))
  }

  async getForegroundApplication(): Promise<ForegroundApplication | null> {
    return foregroundCurrentResultSchema.parse(await this.request('foreground.current')).application
  }

  async getVisibleApplications(): Promise<ForegroundApplication[]> {
    return foregroundApplicationsResultSchema.parse(
      await this.request('applications.list')
    ).applications
  }

  async getDisplays(): Promise<Display[]> {
    return displayListResultSchema.parse(await this.request('displays.list')).displays
  }

  async getDisplayCapabilities(displayId: string): Promise<DisplayCapabilities> {
    return (await this.getDisplayCapabilityReport(displayId)).capabilities
  }

  async getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    const params = displayRequestSchema.parse({ displayId })
    return displayCapabilitiesResultSchema.parse(
      await this.request('display.capabilities', params)
    )
  }

  async getDisplayState(displayId: string): Promise<DisplayState> {
    const params = displayRequestSchema.parse({ displayId })
    return displayStateSchema.parse(await this.request('display.state', params))
  }

  async captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    const params = displayRequestSchema.parse({ displayId })
    return baselineCaptureResultSchema.parse(await this.request('baseline.capture', params))
  }

  async applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    const params = displayApplyRequestSchema.parse({
      displayId,
      settings: displaySettingsSchema.parse(settings)
    })
    return displayApplyResultSchema.parse(await this.request('display.apply', params))
  }

  async restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    const params = displayRequestSchema.parse({ displayId })
    return displayRestoreResultSchema.parse(await this.request('display.restore', params))
  }

  async restoreAllBaselines(): Promise<RestoreAllResult> {
    return restoreAllResultSchema.parse(await this.request('baseline.restoreAll'))
  }

  async request(command: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.running || this.#process === undefined) {
      throw new Error('DisplayService is not running')
    }

    const id = randomUUID()
    const response = new Promise<NativeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`DisplayService request timed out: ${command}`))
      }, this.#options.requestTimeoutMs)
      this.#pending.set(id, { resolve, reject, timeout })
    })

    this.#process.stdin.write(`${JSON.stringify({ id, command, params })}\n`)
    const message = await response
    if (!message.ok) {
      throw new NativeServiceError(message.error.code, message.error.message, command, id)
    }
    return message.result
  }

  async stop(): Promise<void> {
    if (!this.running || this.#process === undefined) {
      return
    }

    const child = this.#process
    await this.request('service.shutdown')
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve()
        return
      }
      const timeout = setTimeout(() => {
        if (child.exitCode === null) child.kill()
        resolve()
      }, this.#options.requestTimeoutMs)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  #handleLine(line: string): void {
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      this.emit('diagnostic', `Invalid JSON from DisplayService: ${line}`)
      return
    }

    const parsed = nativeMessageSchema.safeParse(json)
    if (!parsed.success) {
      this.emit('diagnostic', `Invalid protocol message from DisplayService: ${line}`)
      return
    }

    const response = nativeResponseSchema.safeParse(parsed.data)
    if (response.success) {
      const pending = this.#pending.get(response.data.id)
      if (pending !== undefined) {
        clearTimeout(pending.timeout)
        this.#pending.delete(response.data.id)
        pending.resolve(response.data)
      }
      return
    }

    const event = parsed.data as NativeEvent
    if (event.event === 'service.ready') this.#readyAnnounced = true
    this.emit('event', event)
  }

  #waitForReady(): Promise<void> {
    if (this.#readyAnnounced) return Promise.resolve()
    if (this.#startupError !== undefined) return Promise.reject(this.#startupError)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('DisplayService did not announce readiness'))
      }, this.#options.startupTimeoutMs)
      const onEvent = (event: NativeEvent): void => {
        if (event.event === 'service.ready') {
          cleanup()
          resolve()
        }
      }
      const onExit = (): void => {
        cleanup()
        reject(new Error('DisplayService exited before it was ready'))
      }
      const onFailure = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const cleanup = (): void => {
        clearTimeout(timeout)
        this.off('event', onEvent)
        this.off('exit', onExit)
        this.off('failure', onFailure)
      }
      this.on('event', onEvent)
      this.on('exit', onExit)
      this.on('failure', onFailure)
    })
  }

  #fail(error: Error): void {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.#pending.clear()
    this.#lines?.close()
    this.#lines = undefined
    this.#process = undefined
    this.#readyAnnounced = false
  }
}
