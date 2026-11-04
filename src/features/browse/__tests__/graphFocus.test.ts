import { describe, expect, it } from 'vitest'
import { graphFocus } from '../graphFocus'

describe('graph selection focus', () => {
  it('keeps incoming and outgoing neighbors bright without expanding to second-hop entities', () => {
    expect(graphFocus('building', [
      { source: 'building', target: 'location' },
      { source: 'stakeholder', target: 'building' },
      { source: 'location', target: 'country' },
    ])).toEqual(new Set(['building', 'location', 'stakeholder']))
    expect(graphFocus(null, [])).toBeNull()
  })
})
