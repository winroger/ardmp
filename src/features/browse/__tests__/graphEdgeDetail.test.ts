import { describe, expect, it } from 'vitest'
import { graphEdgeDetail } from '../graphEdgeDetail'

describe('graph connection detail', () => {
  it('reduces both density and opacity when zooming out in By type', () => {
    const overview = graphEdgeDetail(0.25, 'type', 6000)
    const close = graphEdgeDetail(2, 'type', 6000)
    expect(overview.stride).toBeGreaterThan(close.stride)
    expect(overview.opacity).toBeLessThan(close.opacity)
    expect(Math.ceil(6000 / overview.stride)).toBeLessThanOrEqual(160)
    expect(close.stride).toBe(1)
  })
  it('shows every connection in Network and retains small filtered graphs', () => {
    expect(graphEdgeDetail(0.1, 'network', 6000).stride).toBe(1)
    expect(graphEdgeDetail(0.1, 'type', 20).stride).toBe(1)
    expect(graphEdgeDetail(0.1, 'type', 0).stride).toBe(1)
  })
})
