import { describe, expect, it } from 'vitest'
import { layoutReviewNetwork } from '../graphNetworkLayout'

describe('layoutReviewNetwork', () => {
  it('calculates stable positions without mutating the input', () => {
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 500, y: 0 }]
    const positions = layoutReviewNetwork(nodes, [{ source: 'a', target: 'b' }])
    expect(Math.hypot(positions[1].x - positions[0].x, positions[1].y - positions[0].y)).toBeLessThan(150)
    expect(nodes[1].x).toBe(500)
    expect(layoutReviewNetwork(nodes, [{ source: 'a', target: 'b' }])).toEqual(positions)
  })

  it('places connected types near the average position of their anchor entities', () => {
    const nodes = [
      { id: 'a', group: 'Building', x: 0, y: 0 },
      { id: 'b', group: 'Building', x: 40, y: 40 },
      { id: 'org', group: 'Organization', x: 2000, y: 2000 },
      { id: 'isolated', group: 'Source', x: 700, y: 900 },
    ]
    const positions = layoutReviewNetwork(nodes, [{ source: 'a', target: 'org' }, { source: 'b', target: 'org' }])
    const center = { x: (positions[0].x + positions[1].x) / 2, y: (positions[0].y + positions[1].y) / 2 }
    expect(Math.hypot(positions[2].x - center.x, positions[2].y - center.y)).toBeLessThan(65)
    expect(positions[3]).toEqual(nodes[3])
  })

  it('handles empty graphs, isolated or overlapping nodes, self links and missing targets', () => {
    expect(layoutReviewNetwork([], [])).toEqual([])
    const positions = layoutReviewNetwork([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0 }], [
      { source: 'a', target: 'a' }, { source: 'b', target: 'missing' },
    ])
    expect(positions.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
    expect(positions[0]).not.toMatchObject({ x: positions[1].x, y: positions[1].y })
  })
})
