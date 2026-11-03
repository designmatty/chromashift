import { useEffect, useRef } from 'react'

/** A non-passive listener prevents adjusting a control from scrolling its panel. */
export function useWheelAdjustment<T extends HTMLElement>(
  enabled: boolean,
  adjust: (direction: number) => void
): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    const element = ref.current
    if (element === null || !enabled) return
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY === 0 || event.ctrlKey) return
      event.preventDefault()
      adjust(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [enabled, adjust])
  return ref
}
