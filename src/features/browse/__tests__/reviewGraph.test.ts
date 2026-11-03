import { describe, expect, it } from 'vitest'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { buildReviewGraph } from '../reviewGraph'

const a: BrowseSubject = { iri: 'urn:a', label: 'Building A', classes: ['urn:Building', 'urn:Place'], properties: [
  { predicate: 'urn:creator', label: 'Creator', value: 'urn:b', isResource: true },
  { predicate: 'urn:creator', label: 'Creator', value: 'urn:b', isResource: true },
  { predicate: 'urn:name', label: 'Name', value: 'urn:b', isResource: false },
  { predicate: 'urn:source', label: 'Source', value: 'urn:external', isResource: true },
] }
const b: BrowseSubject = { iri: 'urn:b', label: 'Organization B', classes: ['urn:Organization'], properties: [] }
const model: BrowseModel = { totalSubjects: 2, groups: [
  { classIri: 'urn:Building', classLabel: 'Building', count: 1, subjects: [a] },
  { classIri: 'urn:Place', classLabel: 'Place', count: 1, subjects: [a] },
  { classIri: 'urn:Organization', classLabel: 'Organization', count: 1, subjects: [b] },
] }

describe('buildReviewGraph', () => {
  it('deduplicates multi-type entities and repeated relationships, excluding literals and external resources', () => {
    const graph = buildReviewGraph(model, [a, b, a])
    expect(graph.subjectCount).toBe(2)
    expect(graph.edgeCount).toBe(1)
    expect(graph.types.map(type => type.label)).toEqual(['Building', 'Organization'])
    expect(graph.elements.find(element => element.data.source)).toMatchObject({ data: {
      source: 'subject:urn:a', target: 'subject:urn:b', predicate: 'urn:creator',
    } })
  })

  it('removes dangling relationships after filtering and preserves type colors and deterministic positions', () => {
    const full = buildReviewGraph(model, [b, a])
    const filtered = buildReviewGraph(model, [a])
    expect(filtered.subjectCount).toBe(1)
    expect(filtered.edgeCount).toBe(0)
    expect(filtered.types[0].color).toBe(full.types[0].color)
    expect(buildReviewGraph(model, [a, b]).elements).toEqual(full.elements)
    expect(full.elements.every(element => !element.position || (Number.isFinite(element.position.x) && Number.isFinite(element.position.y)))).toBe(true)
  })

  it('supports empty results and untyped subjects', () => {
    expect(buildReviewGraph(model, [])).toMatchObject({ elements: [], types: [], subjectCount: 0, edgeCount: 0 })
    const graph = buildReviewGraph(null, [{ ...b, classes: [] }])
    expect(graph.types[0].label).toBe('Untyped')
    expect(graph.subjectCount).toBe(1)
  })
})
