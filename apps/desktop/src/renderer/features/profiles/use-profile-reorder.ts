import { useEffect, useRef, useState } from 'react'
import { move } from '@dnd-kit/helpers'
import type { DragEndEvent, DragStartEvent, DragOverEvent, DragDropManager } from '@dnd-kit/react'
import {
  Accessibility,
  KeyboardSensor,
  PointerSensor,
  PointerActivationConstraints
} from '@dnd-kit/dom'
import type { Draggable, KeyboardSensorOptions } from '@dnd-kit/dom'
import { DOMRectangle, scrollIntoViewIfNeeded } from '@dnd-kit/dom/utilities'
import { isSortable } from '@dnd-kit/react/sortable'
import type { ProfileReorderDiagnostic } from '@shared/product-api'

// Extend the library's keyboard sensor only for our existing Home/End shortcuts.
class ProfileKeyboardSensor extends KeyboardSensor {
  private jump: Promise<void> | null = null

  constructor(manager: DragDropManager) {
    super(manager, {
      preventActivation: (event) =>
        event.isComposing ||
        !(event.target instanceof Element) ||
        event.target.getAttribute('data-part') !== 'profile-reorder-handle'
    })
  }
  override handleKeyDown(
    event: KeyboardEvent,
    source: Draggable,
    options?: KeyboardSensorOptions
  ): void {
    if (event.code !== 'Home' && event.code !== 'End') {
      if (this.jump && ['Space', 'Enter', 'Tab'].includes(event.code)) {
        event.preventDefault()
        void this.jump.then(() => {
          if (this.manager.dragOperation.status.dragging)
            super.handleKeyDown(event, source, options)
        })
        return
      }
      super.handleKeyDown(event, source, options)
      return
    }
    event.preventDefault()
    const targets = [...this.manager.registry.droppables]
      .filter((target) => !target.disabled && isSortable(target) && target.accepts(source))
      .sort((a, b) => (isSortable(a) && isSortable(b) ? a.index - b.index : 0))
    const target = event.code === 'Home' ? targets[0] : targets.at(-1)
    if (!target || target.id === source.id) return
    const { manager } = this
    manager.collisionObserver.disable()
    this.jump = manager.renderer.rendering
      .then(() => {
        if (manager.dragOperation.status.dragging) return manager.actions.setDropTarget(target.id)
      })
      .then(async () => {
        // Optimistic sorting runs after the target event's render transaction.
        // A quick Enter must wait for that update before it commits the order.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        await manager.renderer.rendering
        if (!manager.dragOperation.status.dragging || !isSortable(source)) return
        const element = source.sortable.element
        const shape = manager.dragOperation.shape
        if (element && shape) {
          scrollIntoViewIfNeeded(element)
          manager.actions.move({ to: new DOMRectangle(element).center })
        }
        await manager.actions.setDropTarget(source.id)
      })
      .finally(() => {
        manager.collisionObserver.enable()
        this.jump = null
      })
  }
}

export const profileReorderSensors = [
  PointerSensor.configure({
    activatorElements: (source) => [source.element],
    preventActivation: (event) =>
      !(event.target instanceof Element) ||
      !event.target.closest('[data-part="profile-select"], [data-part="profile-reorder-handle"]'),
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })]
  }),
  ProfileKeyboardSensor
]

export const profileReorderAccessibility = Accessibility.configure({
  announcements: {
    dragstart: ({ operation: { source } }: DragStartEvent) =>
      `${source?.data.name ?? 'Profile'} picked up.`,
    dragover: ({ operation: { source, target } }: DragOverEvent) =>
      source && target && source.id !== target.id
        ? `${source.data.name} moved to position ${isSortable(target) ? target.index + 2 : ''}.`
        : undefined,
    dragend: ({ operation: { source }, canceled }: DragEndEvent) =>
      canceled ? 'Profile reorder cancelled.' : `${source?.data.name ?? 'Profile'} dropped.`
  }
})

interface ReorderOptions {
  ids: string[]
  disabled: boolean
  collapsed: boolean
  selectedProfileId: string | null
  previewingProfileId: string | null
  onReorder(ids: string[], interactionId?: string): Promise<void>
}

type ReorderInteraction = Omit<ProfileReorderDiagnostic, 'phase' | 'clientTimestamp'>

// dnd-kit owns dragging, animation, collision detection and scrolling. This
// hook owns only the product's persistence, cancellation boundary and shortcuts.
export function useProfileReorder(options: ReorderOptions) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<DragDropManager | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const suppressedClick = useRef(false)
  const savingRef = useRef(false)
  const interactionRef = useRef<ReorderInteraction | null>(null)
  const cancelReasonRef = useRef<ProfileReorderDiagnostic['cancelReason']>(undefined)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const idsKey = options.ids.join('\0')

  useEffect(() => {
    // Persistence can finish before the debounced product-state broadcast.
    // Keep the dropped order until authoritative state acknowledges it.
    if (
      pendingIds &&
      (pendingIds.join('\0') === idsKey ||
        pendingIds.length !== options.ids.length ||
        pendingIds.some((id) => !options.ids.includes(id)))
    )
      setPendingIds(null)
  }, [idsKey, pendingIds])

  useEffect(() => {
    // Suppress only the click generated by the completed drag. A new press is
    // a new intent and must select immediately, even directly after a drop.
    const allowClick = () => {
      suppressedClick.current = false
    }
    window.addEventListener('pointerdown', allowClick, true)
    return () => window.removeEventListener('pointerdown', allowClick, true)
  }, [])

  useEffect(
    () => () => {
      const manager = managerRef.current
      if (manager?.dragOperation.status.dragging) {
        cancelReasonRef.current = 'stateChanged'
        manager.actions.stop({ canceled: true })
      }
      cleanupRef.current?.()
    },
    [idsKey, options.disabled, options.collapsed]
  )

  function record(
    phase: ProfileReorderDiagnostic['phase'],
    details: Partial<ReorderInteraction> = {}
  ): void {
    const interaction = interactionRef.current
    if (!interaction) return
    // Diagnostics must never hold up dragging or cause product actions.
    void window.chromaShift
      .recordProfileReorder({
        ...interaction,
        ...details,
        phase,
        clientTimestamp: new Date().toISOString()
      })
      .catch(() => {})
  }

  function begin(id: string, input: ProfileReorderDiagnostic['input']): void {
    const fromIndex = options.ids.indexOf(id)
    if (fromIndex < 1) return
    cancelReasonRef.current = undefined
    interactionRef.current = {
      interactionId: crypto.randomUUID(),
      profileId: id,
      input,
      fromIndex,
      toIndex: fromIndex,
      selectedProfileId: options.selectedProfileId,
      previewingProfileId: options.previewingProfileId
    }
    record('started', { profileIds: options.ids })
  }

  function commit(ids: string[]): void {
    if (savingRef.current || options.disabled || ids.join('\0') === idsKey) return
    savingRef.current = true
    setSaving(true)
    setPendingIds(ids)
    void options
      .onReorder(ids, interactionRef.current?.interactionId)
      .catch(() => {
        setPendingIds(null)
        setAnnouncement('Could not save profile order. The previous order has been restored.')
      })
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
  }

  function onDragStart(event: DragStartEvent, manager: DragDropManager): void {
    managerRef.current = manager
    const id = String(event.operation.source?.id)
    setActiveId(id)
    begin(id, event.operation.activatorEvent instanceof KeyboardEvent ? 'keyboard' : 'pointer')
    // Stop through the library before its pointer-up listener runs when the
    // user drops outside the sidebar, preserving our cancellation behavior.
    const cancelOutside = (event: PointerEvent) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (
        !rect ||
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        cancelReasonRef.current = 'outsideSidebar'
        manager.actions.stop({ canceled: true })
      }
    }
    const cancelBlur = () => {
      cancelReasonRef.current = 'windowBlur'
      manager.actions.stop({ canceled: true })
    }
    const noteEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelReasonRef.current = 'escape'
    }
    window.addEventListener('pointerup', cancelOutside, true)
    window.addEventListener('blur', cancelBlur)
    window.addEventListener('keydown', noteEscape, true)
    cleanupRef.current = () => {
      window.removeEventListener('pointerup', cancelOutside, true)
      window.removeEventListener('blur', cancelBlur)
      window.removeEventListener('keydown', noteEscape, true)
      cleanupRef.current = null
    }
  }

  function onDragOver(event: DragOverEvent): void {
    const source = event.operation.source
    const interaction = interactionRef.current
    if (!interaction || !source || !isSortable(source)) return
    const toIndex = source.index + 1 // The permanent Default is outside the sortable group.
    if (toIndex === interaction.toIndex) return
    interaction.toIndex = toIndex
    record('positionChanged')
  }

  function onDragEnd(event: DragEndEvent): void {
    cleanupRef.current?.()
    setActiveId(null)
    suppressedClick.current = true
    if (event.canceled) {
      record('cancelled', { cancelReason: cancelReasonRef.current ?? 'sensor' })
      return
    }
    const pinned = options.ids.filter((id) => id.toLowerCase() === 'default')
    const movable = options.ids.filter((id) => id.toLowerCase() !== 'default')
    const ids = [...pinned, ...move(movable, event)]
    record('dropped', {
      toIndex: ids.indexOf(String(event.operation.source?.id)),
      profileIds: ids
    })
    commit(ids)
  }

  function onKeyDown(id: string, event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (
      event.nativeEvent.isComposing ||
      !event.altKey ||
      (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
      activeId !== null
    )
      return
    if (savingRef.current || pendingIds !== null || options.disabled) return
    const from = options.ids.indexOf(id)
    const to = from + (event.key === 'ArrowUp' ? -1 : 1)
    if (from < 1 || to < 1 || to >= options.ids.length) return
    event.preventDefault()
    const ids = [...options.ids]
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    begin(id, 'shortcut')
    record('dropped', { toIndex: to, profileIds: ids })
    setAnnouncement(`Profile moved to position ${to + 1} of ${ids.length}.`)
    commit(ids)
  }

  return {
    viewportRef,
    activeId,
    announcement,
    ids: pendingIds ?? options.ids,
    saving: saving || pendingIds !== null,
    onDragStart,
    onDragOver,
    onDragEnd,
    onKeyDown,
    suppressClick: (clickedProfileId: string) => {
      if (suppressedClick.current) record('clickSuppressed', { clickedProfileId })
      return suppressedClick.current
    }
  }
}
