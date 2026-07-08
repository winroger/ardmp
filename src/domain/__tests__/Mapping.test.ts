import { describe, expect, it } from 'vitest'
import { MappingState } from '@/domain/Mapping'

describe('MappingState', () => {
  it('starts empty', () => {
    const m = new MappingState()
    expect(m.hasMappings).toBe(false)
    expect(m.edges).toEqual([])
  })

  it('adds an edge', () => {
    const m = new MappingState()
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Name', shapeIri: 'http://x/Shape', propertyPath: 'http://x/name' })
    expect(m.edges).toHaveLength(1)
    expect(m.hasMappings).toBe(true)
  })

  it('replaces an existing edge for the same shape+property', () => {
    const m = new MappingState()
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Name', shapeIri: 'http://x/Shape', propertyPath: 'http://x/name' })
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Vorname', shapeIri: 'http://x/Shape', propertyPath: 'http://x/name' })
    expect(m.edges).toHaveLength(1)
    expect(m.edges[0].sourceHeader).toBe('Vorname')
  })

  it('removes by shape+property', () => {
    const m = new MappingState()
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Name', shapeIri: 'http://x/Shape', propertyPath: 'http://x/name' })
    m.remove('http://x/Shape', 'http://x/name')
    expect(m.edges).toHaveLength(0)
  })

  it('looks up edges per shape', () => {
    const m = new MappingState()
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Name', shapeIri: 'http://x/A', propertyPath: 'http://x/name' })
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Email', shapeIri: 'http://x/A', propertyPath: 'http://x/email' })
    m.addOrReplace({ sourceId: 'csv', sourceHeader: 'Title', shapeIri: 'http://x/B', propertyPath: 'http://x/title' })
    expect(m.forShape('http://x/A')).toHaveLength(2)
    expect(m.forShape('http://x/B')).toHaveLength(1)
  })

  it('reports the source for a shape', () => {
    const m = new MappingState()
    m.addOrReplace({ sourceId: 'people-csv', sourceHeader: 'Name', shapeIri: 'http://x/A', propertyPath: 'http://x/name' })
    expect(m.sourceForShape('http://x/A')).toBe('people-csv')
    expect(m.sourceForShape('http://x/Z')).toBeUndefined()
  })

  it('keeps staging columns active by default and can disable them per source', () => {
    const m = new MappingState()

    expect(m.isStagingColumnActive('people', 'Email')).toBe(true)

    m.setStagingColumnActive('people', 'Email', false)
    expect(m.isStagingColumnActive('people', 'Email')).toBe(false)
    expect(m.isStagingColumnActive('people', 'Name')).toBe(true)

    m.setStagingColumnActive('people', 'Email', true)
    expect(m.isStagingColumnActive('people', 'Email')).toBe(true)
  })

  it('can toggle the staging graph for all unmapped headers of a source', () => {
    const m = new MappingState()

    expect(m.stagingGraphStateForSource('people', ['Name', 'Email', 'Role'], ['Role'])).toBe('enabled')

    m.setStagingGraphActive('people', ['Name', 'Email', 'Role'], false, ['Role'])
    expect(m.isStagingColumnActive('people', 'Name')).toBe(false)
    expect(m.isStagingColumnActive('people', 'Email')).toBe(false)
    expect(m.isStagingColumnActive('people', 'Role')).toBe(true)
    expect(m.stagingGraphStateForSource('people', ['Name', 'Email', 'Role'], ['Role'])).toBe('disabled')

    m.setStagingColumnActive('people', 'Name', true)
    expect(m.stagingGraphStateForSource('people', ['Name', 'Email', 'Role'], ['Role'])).toBe('partial')

    m.setStagingGraphActive('people', ['Name', 'Email', 'Role'], true, ['Role'])
    expect(m.stagingGraphStateForSource('people', ['Name', 'Email', 'Role'], ['Role'])).toBe('enabled')
  })
})



