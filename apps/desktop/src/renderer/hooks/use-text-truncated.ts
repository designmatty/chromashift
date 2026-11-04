import { useEffect, useState } from 'react'

export function isTextTruncated(
  element: Pick<HTMLElement, 'scrollWidth' | 'clientWidth'>
): boolean {
  return element.scrollWidth > element.clientWidth
}

/**
 * Track whether a single-line ellipsis element currently hides part of its
 * text. Re-measures when the element resizes or its text changes.
 */
export function useTextTruncated<T extends HTMLElement>(
  text: string
): [(element: T | null) => void, boolean] {
  const [element, setElement] = useState<T | null>(null)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    if (element === null) return
    const measure = () => setTruncated(isTextTruncated(element))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, text])
  return [setElement, truncated]
}
