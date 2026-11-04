import { describe, expect, it } from 'vitest'
import { isTextTruncated } from '@/hooks/use-text-truncated'

describe('isTextTruncated', () => {
  it('reports truncation only when the text is wider than its box', () => {
    expect(isTextTruncated({ scrollWidth: 240, clientWidth: 120 })).toBe(true)
    expect(isTextTruncated({ scrollWidth: 120, clientWidth: 120 })).toBe(false)
    expect(isTextTruncated({ scrollWidth: 80, clientWidth: 120 })).toBe(false)
  })
})
