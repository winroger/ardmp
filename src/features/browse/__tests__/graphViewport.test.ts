import { describe, expect, it } from 'vitest'
import { resizeGraphViewport, zoomGraphAt } from '../graphViewport'

describe('graph viewport', () => {
  it('keeps the graph point under the cursor fixed during zoom and at the limits', () => {
    const view = { x: -130, y: 75, scale: 0.8 }
    for (const factor of [1.25, 0.8, 1000, 0.00001]) {
      const next = zoomGraphAt(view, factor, 430, 220)
      expect((430 - next.x) / next.scale).toBeCloseTo((430 - view.x) / view.scale)
      expect((220 - next.y) / next.scale).toBeCloseTo((220 - view.y) / view.scale)
      expect(next.scale).toBeGreaterThanOrEqual(0.02)
      expect(next.scale).toBeLessThanOrEqual(8)
    }
  })
  it('reverses a zoom without changing the pan', () => {
    const view = { x: 73, y: -95, scale: 1.4 }
    const next = zoomGraphAt(zoomGraphAt(view, 1.25, 570, 215), 0.8, 570, 215)
    expect(next.x).toBeCloseTo(view.x)
    expect(next.y).toBeCloseTo(view.y)
    expect(next.scale).toBeCloseTo(view.scale)
  })
  it('preserves scale and the world point at the center on resize', () => {
    const view = { x: 120, y: -32, scale: 1.7 }
    const next = resizeGraphViewport(view, 200, -100)
    expect(next.scale).toBe(view.scale)
    expect((500 - next.x) / next.scale).toBeCloseTo((400 - view.x) / view.scale)
    expect((250 - next.y) / next.scale).toBeCloseTo((300 - view.y) / view.scale)
  })
})
