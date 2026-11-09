import {
  activeColorTargets,
  type ColorProfile,
  type ColorSettingName,
  type ColorSettings,
  type DisplayColorTarget
} from '@chromashift/core'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplayRestoreResult
} from '@chromashift/native-client'
import type { PreviewState } from '@shared/product-api.js'
import { profilesDiffer } from '@shared/unsaved-changes.js'
import { describeError } from '@main/structured-logger.js'
import type { PanelHideReason } from '@main/panel-controller.js'
import type { ProfileRepository } from '@chromashift/core'
import type { LearnedGammaLimits } from '@main/learned-gamma-limits.js'

export interface PreviewNativePort {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: ColorSettings): Promise<DisplayApplyResult>
  restoreDisplay(displayId: string): Promise<DisplayRestoreResult>
}

export interface PreviewActivationPort {
  /** Drains activation writes and returns the baselines it may still own. */
  beginPreview(): Promise<readonly string[]>
  cancelPreview(retainedDisplayIds?: readonly string[]): Promise<void>
  confirmPreview(profileId: string, retainedDisplayIds?: readonly string[]): Promise<void>
}

export interface PreviewRecoveryPort {
  restoreFailed(): Promise<void>
  restored(): Promise<void>
}

export class PreviewValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PreviewValidationError'
  }
}

export class PreviewRestoreError extends Error {
  public readonly failures: readonly string[]

  public constructor(
    failures: readonly string[],
    public readonly displayIds?: readonly string[]
  ) {
    super(`Some displays could not be restored. ${failures.join(' ')}`)
    this.name = 'PreviewRestoreError'
    this.failures = failures
  }
}

interface ActivePreview {
  version: number
  draft: ColorProfile
  saved: ColorProfile
  profileId: string
  kind: 'preview' | 'edit' | 'override'
  /** Session targets, including desired values deferred by HDR or disconnection. */
  applied: Map<string, DisplayColorTarget>
  /** Activation-owned baselines plus every display written by this session. */
  touched: Map<string, string>
  /** Capability checks already passed, keyed by lowercased display ID. */
  validated: Map<string, Set<ColorSettingName>>
  /** Desired targets currently absent from the native display snapshot. */
  disconnected: Set<string>
}

function hasUnsavedChanges(active: ActivePreview): boolean {
  return active.kind !== 'preview' && profilesDiffer(active.draft, active.saved)
}

interface RestoreTouchedResult {
  failures: string[]
  retainedDisplayIds: string[]
}

type PreviewRecovery = {
  kind: 'continuation' | 'teardown'
  displayIds: readonly string[]
}

/**
 * One atomic profile-edit session spanning several displays. Each display previews
 * its own draft settings, switching the edited display keeps the rest of the draft,
 * and teardown restores every display the session touched before handing control
 * back to the activation controller.
 */
export class PreviewSessionController {
  #active: ActivePreview | null = null
  // Teardown supersedes continuation, including the displays Retry must restore.
  #recovery: PreviewRecovery | null = null
  #operationTail: Promise<void> = Promise.resolve()
  #startVersion = 0

  public constructor(
    private readonly native: PreviewNativePort,
    private readonly activation: PreviewActivationPort,
    private readonly onStateChanged: (state: PreviewState) => void,
    private readonly recovery: PreviewRecoveryPort = {
      restoreFailed: async () => undefined,
      restored: async () => undefined
    },
    private readonly limits?: LearnedGammaLimits,
    private readonly repository?: ProfileRepository
  ) {}

  public get state(): PreviewState {
    if (this.#active === null) return { state: 'inactive' }
    if (this.#recovery?.kind === 'teardown') {
      return { state: 'restorePending', displayIds: [...this.#recovery.displayIds] }
    }
    return {
      state: 'active',
      profileId: this.#active.profileId,
      kind: this.#active.kind,
      draft: structuredClone(this.#active.draft),
      unsavedChanges: hasUnsavedChanges(this.#active),
      targets: [...this.#active.applied.values()].map((target) => ({
        displayId: target.displayId,
        color: { ...target.color }
      }))
    }
  }

  /** The full unsaved draft, for main-process flows that outlive the renderer. */
  public get unsavedDraft(): ColorProfile | null {
    if (this.#active === null || !hasUnsavedChanges(this.#active)) return null
    return structuredClone(this.#active.draft)
  }

  public get sessionRecoveryPending(): boolean {
    return this.#recovery?.kind === 'continuation'
  }

  /** Refresh saved content without changing the applied draft or display ownership. */
  public async profileSaved(profile: ColorProfile): Promise<void> {
    return this.#enqueue(async () => {
      const active = this.#active
      if (active === null || active.profileId.toLowerCase() !== profile.id.toLowerCase()) return
      if (!profilesDiffer(active.draft, active.saved)) {
        active.draft = structuredClone({ ...profile, displays: active.draft.displays })
      }
      active.saved = structuredClone(profile)
      this.onStateChanged(this.state)
    })
  }

  public async start(
    profile: ColorProfile,
    kind: 'preview' | 'edit' | 'override',
    saved = profile
  ): Promise<void> {
    const version = ++this.#startVersion
    return this.#enqueue(() => this.#start(profile, kind, saved, version))
  }

  async #start(
    profile: ColorProfile,
    kind: 'preview' | 'edit' | 'override',
    saved: ColorProfile,
    version: number
  ): Promise<void> {
    if (this.#recovery !== null) {
      throw new PreviewValidationError('Restore the pending displays before starting a preview.')
    }
    await this.limits?.refreshApplicability()
    profile = this.limits?.clampProfile(profile) ?? profile
    const targets = activeColorTargets(profile)
    if (this.#active !== null && this.#canReuseSession(profile.id, targets, kind)) {
      const changed = this.#active.kind !== kind || profilesDiffer(this.#active.draft, profile)
      this.#active.version = version
      this.#active.draft = structuredClone(profile)
      if (this.#active.kind !== 'edit' && kind === 'edit') {
        this.#active.kind = 'edit'
      }
      if (changed) this.onStateChanged(this.state)
      return
    }
    if (this.#active !== null) {
      const rollback = await this.#teardown()
      if (rollback.failures.length > 0) throw new PreviewRestoreError(rollback.failures)
    }

    const validated = new Map<string, Set<ColorSettingName>>()
    const displays = await this.native.getDisplays()
    await this.#validateTargets(targets, validated, displays, true)
    const ownedDisplayIds = await this.activation.beginPreview()

    const applied = new Map<string, DisplayColorTarget>()
    const touched = new Map(ownedDisplayIds.map((id) => [id.toLowerCase(), id]))
    const writableDisplayIds = new Set(
      displays.filter((display) => !display.hdr).map((display) => display.id.toLowerCase())
    )
    const disconnected = new Set(
      targets
        .filter((target) => !writableDisplayIds.has(target.displayId.toLowerCase()))
        .map((target) => target.displayId.toLowerCase())
    )
    try {
      await this.#restoreHdrDisplays(touched, displays)
      if (kind !== 'override') await this.#holdOriginal(touched, targets)
      for (const target of targets) {
        const key = target.displayId.toLowerCase()
        if (disconnected.has(key)) continue
        try {
          await this.native.captureBaseline(target.displayId)
          touched.set(key, target.displayId)
        } catch (error) {
          if (!this.#isDisplayDeferred(error)) throw error
          disconnected.add(key)
        }
      }
      for (const target of targets) {
        const key = target.displayId.toLowerCase()
        if (!disconnected.has(key)) {
          try {
            await this.#applyTarget(target)
          } catch (error) {
            if (!this.#isDisplayDeferred(error)) throw error
            disconnected.add(key)
          }
        }
        applied.set(key, target)
      }
      saved = await this.#clampSaved(saved)
    } catch (error) {
      // Even a partially started session owns the displays it may have changed.
      this.#active = {
        version,
        profileId: profile.id,
        kind,
        draft: structuredClone(profile),
        saved: structuredClone(saved),
        applied,
        touched,
        validated,
        disconnected
      }
      if (error instanceof PreviewRestoreError) {
        this.#active.applied = new Map(
          targets.map((target) => [target.displayId.toLowerCase(), target])
        )
        await this.#retainSessionForRecovery(error)
        throw error
      }
      const rollback = await this.#teardown()
      if (rollback.failures.length > 0) throw new PreviewRestoreError(rollback.failures)
      throw error
    }

    this.#active = {
      version,
      profileId: profile.id,
      kind,
      draft: structuredClone({ ...profile, displays: targets }),
      saved: structuredClone(saved),
      applied,
      touched,
      validated,
      disconnected
    }
    this.onStateChanged(this.state)
  }

  public async update(
    profileId: string,
    targets: DisplayColorTarget[],
    draft?: ColorProfile
  ): Promise<void> {
    return this.#enqueue(async () => {
      this.#requireActive(profileId)
      try {
        await this.#update(profileId, targets)
        const active = this.#requireActive(profileId)
        active.draft = structuredClone({
          ...(draft ?? active.draft),
          displays: [...active.applied.values()]
        })
        active.saved = await this.#clampSaved(active.saved)
        this.onStateChanged(this.state)
      } catch (error) {
        if (error instanceof PreviewRestoreError) {
          const active = this.#active!
          active.draft = structuredClone({ ...(draft ?? active.draft), displays: targets })
          active.applied = new Map(
            targets.map((target) => [target.displayId.toLowerCase(), target])
          )
          await this.#retainSessionForRecovery(error)
          throw error
        }
        const rollback = await this.#teardown()
        if (rollback.failures.length > 0) throw new PreviewRestoreError(rollback.failures)
        throw error
      }
    })
  }

  async #update(profileId: string, targets: DisplayColorTarget[]): Promise<void> {
    const active = this.#requireActive(profileId)
    const displays = await this.native.getDisplays()
    await this.#restoreHdrDisplays(active.touched, displays)
    for (const display of displays) {
      if (display.hdr) {
        active.disconnected.add(display.id.toLowerCase())
        active.validated.delete(display.id.toLowerCase())
      }
    }
    const desired = targets
    const connectedDesired = desired.filter(
      (target) => !active.disconnected.has(target.displayId.toLowerCase())
    )
    await this.#validateTargets(connectedDesired, active.validated, undefined, true)
    for (const target of connectedDesired) {
      if (!this.#isTargetValidated(target, active.validated)) {
        active.disconnected.add(target.displayId.toLowerCase())
      }
    }

    const desiredKeys = new Set(desired.map((target) => target.displayId.toLowerCase()))
    for (const [key, target] of [...active.applied]) {
      if (desiredKeys.has(key)) continue
      const restored = await this.#restoreDisplayIds([target.displayId])
      if (restored.failures.length > 0)
        throw new PreviewRestoreError(restored.failures, restored.retainedDisplayIds)
      active.applied.delete(key)
      active.disconnected.delete(key)
    }

    for (const target of desired) {
      const key = target.displayId.toLowerCase()
      const current = active.applied.get(key)
      if (current !== undefined && sameColorSettings(current.color, target.color)) continue
      if (active.disconnected.has(key)) {
        active.applied.set(key, { displayId: target.displayId, color: { ...target.color } })
        continue
      }
      if (current === undefined) {
        try {
          await this.native.captureBaseline(target.displayId)
          active.touched.set(key, target.displayId)
        } catch (error) {
          if (!this.#isDisplayDeferred(error)) throw error
          active.disconnected.add(key)
        }
      }
      if (!active.disconnected.has(key)) {
        try {
          await this.#applyTarget(target)
        } catch (error) {
          if (!this.#isDisplayDeferred(error)) throw error
          active.disconnected.add(key)
        }
      }
      active.applied.set(key, { displayId: target.displayId, color: { ...target.color } })
    }
  }

  public async confirm(profileId: string): Promise<void> {
    return this.#enqueue(() => this.#complete(profileId, 'manual'))
  }

  public async completePreservingMode(profileId: string): Promise<void> {
    return this.#enqueue(() => this.#complete(profileId, 'preserve'))
  }

  async #complete(profileId: string, activation: 'manual' | 'preserve'): Promise<void> {
    this.#requireActive(profileId)
    const rollback = await this.#restoreTouched()
    if (rollback.failures.length > 0) {
      await this.#retainFailedRestore(rollback)
      throw new PreviewRestoreError(rollback.failures)
    }
    this.#active = null
    try {
      if (activation === 'manual') {
        await this.activation.confirmPreview(profileId, rollback.retainedDisplayIds)
      } else {
        await this.activation.cancelPreview(rollback.retainedDisplayIds)
      }
    } finally {
      this.onStateChanged(this.state)
    }
  }

  public async cancel(): Promise<void> {
    return this.#enqueue(async () => {
      const rollback = await this.#teardown()
      if (rollback.failures.length > 0) throw new PreviewRestoreError(rollback.failures)
    })
  }

  public get panelHideScope(): number {
    return this.#startVersion
  }

  /** Drain only sessions admitted before this close, including pending starts. */
  public async cancelForPanelHide(
    reason: PanelHideReason,
    onCancelled?: () => void,
    scope = this.panelHideScope
  ): Promise<void> {
    await this.#enqueue(async () => {
      // A reopened panel owns any newer session. Its start is serialized
      // behind the restoration owed by the closing panel.
      if (
        this.#active !== null &&
        this.#active.version <= scope &&
        (reason === 'close' ||
          this.#recovery?.kind === 'teardown' ||
          this.#active.kind !== 'override')
      ) {
        const rollback = await this.#teardown()
        if (rollback.failures.length > 0) throw new PreviewRestoreError(rollback.failures)
      }
      // Completion belongs to the closing window even when a newer session
      // now owns preview. The caller guards release against a newer opening.
      onCancelled?.()
    })
  }

  public async dispose(): Promise<void> {
    await this.cancel()
  }

  /** Called only after restore-all confirmed restoration of every owned display. */
  public restoreAllConfirmed(): Promise<void> {
    return this.#enqueue(async () => {
      this.#active = null
      this.#recovery = null
      // A failed rollback keeps activation suspended; confirmed restore-all
      // releases only that hold, without resuming the intended profile.
      await this.activation.cancelPreview([])
      this.onStateChanged(this.state)
    })
  }

  public waitForIdle(): Promise<void> {
    return this.#operationTail
  }

  public reapplyAfterDisplayTransition(): Promise<boolean> {
    return this.#enqueue(async () => {
      try {
        return await this.#reapplyAfterDisplayTransition()
      } catch (error) {
        if (error instanceof PreviewRestoreError) {
          await this.#retainSessionForRecovery(error)
          throw error
        }
        const rollback = await this.#teardown()
        if (rollback.failures.length > 0) throw new PreviewRestoreError(rollback.failures)
        throw error
      }
    })
  }

  /** Retry an interrupted Edit/override without ending it or restoring unaffected SDR targets. */
  public retryRestoration(): Promise<boolean> {
    return this.#enqueue(async () => {
      const recovery = this.#recovery
      if (recovery?.kind !== 'continuation') return false
      const result = await this.#restoreDisplayIds(recovery.displayIds)
      const retained = new Set(result.retainedDisplayIds.map((id) => id.toLowerCase()))
      for (const id of recovery.displayIds) {
        if (!retained.has(id.toLowerCase())) this.#active?.touched.delete(id.toLowerCase())
      }
      if (result.failures.length > 0) {
        const error = new PreviewRestoreError(result.failures, result.retainedDisplayIds)
        await this.#retainSessionForRecovery(error)
        throw error
      }
      this.#recovery = null
      try {
        return await this.#reapplyAfterDisplayTransition()
      } catch (error) {
        await this.#retainSessionForRecovery(
          error instanceof PreviewRestoreError
            ? error
            : new PreviewRestoreError([describeError(error).message])
        )
        throw error
      }
    })
  }

  async #retainSessionForRecovery(error: PreviewRestoreError): Promise<void> {
    this.#recovery = {
      kind: 'continuation',
      displayIds: error.displayIds ?? [...(this.#active?.touched.values() ?? [])]
    }
    try {
      await this.recovery.restoreFailed()
    } finally {
      this.onStateChanged(this.state)
    }
  }

  async #reapplyAfterDisplayTransition(): Promise<boolean> {
    const active = this.#active
    if (active === null) return false
    // A topology event must never reapply values whose rollback is unconfirmed.
    if (this.#recovery !== null) return true

    const displays = await this.native.getDisplays()
    await this.#restoreHdrDisplays(active.touched, displays)
    const connectedDisplayIds = new Set(
      displays.filter((display) => !display.hdr).map((display) => display.id.toLowerCase())
    )
    active.disconnected.clear()
    for (const target of active.applied.values()) {
      if (!connectedDisplayIds.has(target.displayId.toLowerCase())) {
        active.disconnected.add(target.displayId.toLowerCase())
      }
    }
    const targets = [...active.applied.values()].filter((target) =>
      connectedDisplayIds.has(target.displayId.toLowerCase())
    )
    active.validated.clear()
    await this.#validateTargets(targets, active.validated, displays, true)
    if (active.kind !== 'override') {
      await this.#holdOriginal(active.touched, [...active.applied.values()])
    }
    for (const target of targets) {
      if (!this.#isTargetValidated(target, active.validated)) continue
      try {
        await this.native.captureBaseline(target.displayId)
        active.touched.set(target.displayId.toLowerCase(), target.displayId)
        await this.#applyTarget(target)
      } catch (error) {
        if (!this.#isDisplayDeferred(error)) throw error
        const key = target.displayId.toLowerCase()
        active.validated.delete(key)
        active.disconnected.add(key)
      }
    }
    active.draft = {
      ...active.draft,
      displays: [...active.applied.values()].map((target) => structuredClone(target))
    }
    active.saved = await this.#clampSaved(active.saved)
    this.onStateChanged(this.state)
    return true
  }

  /**
   * Restores every display this session wrote and returns control to the
   * activation controller, which reasserts the correct automatic/manual target.
   */
  async #teardown(): Promise<RestoreTouchedResult> {
    if (this.#active === null) return { failures: [], retainedDisplayIds: [] }
    const rollback = await this.#restoreTouched()
    if (rollback.failures.length > 0) {
      await this.#retainFailedRestore(rollback)
      return rollback
    }
    await this.#endSession(rollback)
    return rollback
  }

  async #endSession(rollback: RestoreTouchedResult): Promise<void> {
    const recovering = this.#recovery !== null
    this.#active = null
    this.#recovery = null
    try {
      await this.activation.cancelPreview(rollback.retainedDisplayIds)
      if (recovering) await this.recovery.restored()
    } finally {
      this.onStateChanged(this.state)
    }
  }

  async #retainFailedRestore(rollback: RestoreTouchedResult): Promise<void> {
    const active = this.#active
    if (active === null) return
    this.#recovery = { kind: 'teardown', displayIds: rollback.retainedDisplayIds }
    const retained = new Set(rollback.retainedDisplayIds.map((id) => id.toLowerCase()))
    for (const key of active.touched.keys()) {
      if (retained.has(key)) continue
      active.applied.delete(key)
      active.touched.delete(key)
    }
    try {
      await this.recovery.restoreFailed()
    } finally {
      this.onStateChanged(this.state)
    }
  }

  async #restoreTouched(): Promise<RestoreTouchedResult> {
    if (this.#active === null) return { failures: [], retainedDisplayIds: [] }
    return this.#restoreDisplayIds(
      this.#recovery?.kind === 'teardown'
        ? this.#recovery.displayIds
        : this.#active.touched.values()
    )
  }

  /** HDR blocks desired settings, but never restoration of a captured baseline. */
  async #restoreHdrDisplays(
    touched: Map<string, string>,
    displays: readonly Display[]
  ): Promise<void> {
    const hdrIds = new Set(
      displays.filter((display) => display.hdr).map((display) => display.id.toLowerCase())
    )
    const displayIds = [...touched].filter(([key]) => hdrIds.has(key)).map(([, id]) => id)
    if (displayIds.length === 0) return
    const result = await this.#restoreDisplayIds(displayIds)
    const retained = new Set(result.retainedDisplayIds.map((id) => id.toLowerCase()))
    for (const id of displayIds) {
      if (!retained.has(id.toLowerCase())) touched.delete(id.toLowerCase())
    }
    if (result.failures.length > 0)
      throw new PreviewRestoreError(result.failures, result.retainedDisplayIds)
  }

  /** Restore only known baselines. Missing targets never cause baseline capture. */
  async #holdOriginal(
    touched: Map<string, string>,
    targets: readonly DisplayColorTarget[]
  ): Promise<void> {
    const desired = new Set(targets.map((target) => target.displayId.toLowerCase()))
    const result = await this.#restoreDisplayIds(
      [...touched].filter(([key]) => !desired.has(key)).map(([, id]) => id)
    )
    if (result.failures.length > 0)
      throw new PreviewRestoreError(result.failures, result.retainedDisplayIds)
  }

  async #restoreDisplayIds(displayIds: Iterable<string>): Promise<RestoreTouchedResult> {
    const failures: string[] = []
    const retainedDisplayIds: string[] = []
    let connectedDisplayIds: Set<string> | undefined
    try {
      const displays = await this.native.getDisplays()
      connectedDisplayIds = new Set(displays.map((display) => display.id.toLowerCase()))
    } catch {
      // Enumeration failure must not suppress a restore attempt.
    }

    for (const displayId of displayIds) {
      if (connectedDisplayIds !== undefined && !connectedDisplayIds.has(displayId.toLowerCase())) {
        retainedDisplayIds.push(displayId)
        continue
      }
      try {
        const result = await this.native.restoreDisplay(displayId)
        if (result.restored || result.reason === 'baselineNotCaptured') continue
        if (result.code === 'DISPLAY_NOT_FOUND') {
          retainedDisplayIds.push(displayId)
        } else {
          failures.push(
            `${displayId}: ${result.error ?? `Display was not restored: ${result.reason ?? 'unknown reason'}.`}`
          )
          retainedDisplayIds.push(displayId)
        }
      } catch (error) {
        const details = describeError(error)
        if (details.code === 'DISPLAY_NOT_FOUND') {
          retainedDisplayIds.push(displayId)
        } else {
          failures.push(`${displayId}: ${details.message}`)
          retainedDisplayIds.push(displayId)
        }
      }
    }
    return { failures, retainedDisplayIds }
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation)
    this.#operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /**
   * Capability and HDR gating is evaluated per display, so an unsupported control
   * on one display never blocks a different display's settings.
   */
  async #validateTargets(
    targets: readonly DisplayColorTarget[],
    validated: Map<string, Set<ColorSettingName>>,
    knownDisplays?: readonly Display[],
    deferDisconnected = false
  ): Promise<void> {
    const pending = targets
      .map((target) => ({
        target,
        settings: settingNames(target.color).filter(
          (setting) => !validated.get(target.displayId.toLowerCase())?.has(setting)
        )
      }))
      .filter((entry) => entry.settings.length > 0)
    if (pending.length === 0) return

    const displays = knownDisplays ?? (await this.native.getDisplays())
    const displayMap = new Map(displays.map((display) => [display.id.toLowerCase(), display]))

    for (const { target, settings } of pending) {
      const key = target.displayId.toLowerCase()
      const display = displayMap.get(key)
      if (display === undefined) {
        if (deferDisconnected) continue
        throw new PreviewValidationError(`Display ${target.displayId} is no longer connected.`)
      }
      if (display.hdr && deferDisconnected) continue

      let report: DisplayCapabilityReport
      try {
        report = await this.native.getDisplayCapabilityReport(display.id)
      } catch (error) {
        if (deferDisconnected && this.#isDisplayDeferred(error)) continue
        throw error
      }
      for (const setting of settings) {
        const capability = report.capabilities[setting]
        if (!capability.supported) continue
        if (
          display.hdr &&
          capability.provider === 'windows' &&
          (setting === 'brightness' || setting === 'contrast' || setting === 'gamma')
        ) {
          throw new PreviewValidationError(
            `${formatSetting(setting)} is disabled for ${display.name} because Windows gamma controls are unsafe while HDR is active.`
          )
        }
      }

      const known = validated.get(key) ?? new Set<ColorSettingName>()
      for (const setting of settings) known.add(setting)
      validated.set(key, known)
    }
  }

  #isTargetValidated(
    target: DisplayColorTarget,
    validated: Map<string, Set<ColorSettingName>>
  ): boolean {
    const known = validated.get(target.displayId.toLowerCase())
    return known !== undefined && settingNames(target.color).every((setting) => known.has(setting))
  }

  #isDisplayDeferred(error: unknown): boolean {
    const code = describeError(error).code
    return code === 'DISPLAY_NOT_FOUND' || code === 'HDR_UNSAFE'
  }

  async #applyTarget(target: DisplayColorTarget): Promise<void> {
    try {
      const result = await this.native.applyDisplaySettings(target.displayId, target.color)
      if (result.applied.gamma !== undefined)
        target.color = { ...target.color, gamma: result.applied.gamma }
    } catch (error) {
      const details = describeError(error)
      if (details.code === 'BASELINE_RESTORE_FAILED') {
        throw new PreviewRestoreError(
          [`${target.displayId}: ${details.message}`],
          [target.displayId]
        )
      }
      throw error
    }
  }

  async #clampSaved(saved: ColorProfile): Promise<ColorProfile> {
    if (this.limits === undefined || this.repository === undefined) return structuredClone(saved)
    await this.limits.clampSavedProfile(this.repository, saved.id)
    // Rebase only gamma in the session reference. Never replace unsaved content.
    return this.limits.clampProfile(saved)
  }

  #requireActive(profileId: string): ActivePreview {
    if (this.#recovery !== null) {
      throw new PreviewValidationError('Restore the pending displays before changing a preview.')
    }
    if (this.#active === null) throw new PreviewValidationError('No preview is active.')
    if (this.#active.profileId.toLowerCase() !== profileId.toLowerCase()) {
      throw new PreviewValidationError('The active preview belongs to a different profile.')
    }
    return this.#active
  }

  #canReuseSession(
    profileId: string,
    targets: readonly DisplayColorTarget[],
    kind: ActivePreview['kind']
  ): boolean {
    if (this.#active === null) return false
    if (this.#active.profileId.toLowerCase() !== profileId.toLowerCase()) return false
    if (this.#active.kind !== kind && !(kind === 'edit' && this.#active.kind !== 'edit')) {
      return false
    }
    if (this.#active.applied.size !== targets.length) return false
    return targets.every((target) => {
      const current = this.#active?.applied.get(target.displayId.toLowerCase())
      return current !== undefined && sameColorSettings(current.color, target.color)
    })
  }
}

function settingNames(color: ColorSettings): ColorSettingName[] {
  return Object.keys(color) as ColorSettingName[]
}

function sameColorSettings(left: ColorSettings, right: ColorSettings): boolean {
  const leftNames = settingNames(left)
  const rightNames = settingNames(right)
  return (
    leftNames.length === rightNames.length &&
    leftNames.every((setting) => left[setting] === right[setting])
  )
}

function formatSetting(setting: string): string {
  return setting.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}
