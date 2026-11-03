import { describe, expect, it } from 'vitest'
import { graph, parse } from 'rdflib'
import { normalizeViewerGraph, restoreViewerGraph, snapshotViewerGraph } from '@/features/crate-viewer/rdfSnapshot'

describe('viewer RDF snapshots', () => {
  it('retains blank node identities, literal languages/datatypes and RDF collections through JSON', () => {
    const source = graph()
    parse('@prefix ex: <http://example.org/> . ex:b ex:items ("one"@en "two"); ex:child [ex:label "Name"@de]; ex:number 42 .', source, 'http://example.org/', 'text/turtle')
    const normalized = normalizeViewerGraph(source)
    const snapshot = snapshotViewerGraph(normalized)
    const restored = restoreViewerGraph(JSON.parse(JSON.stringify(snapshot)))
    expect(snapshotViewerGraph(restored)).toEqual(snapshot)
    expect(restored.statements.filter(statement => statement.predicate.value.endsWith('#first'))).toHaveLength(2)
    expect(restored.statements.some(statement => statement.object.termType === 'Literal' && statement.object.language === 'de')).toBe(true)
    expect(restored.statements.some(statement => statement.object.termType === 'Literal' && statement.object.datatype.value.endsWith('#integer'))).toBe(true)
    expect(restored.statements.filter(statement => statement.subject.termType === 'BlankNode').map(statement => statement.subject.value))
      .toEqual(normalized.statements.filter(statement => statement.subject.termType === 'BlankNode').map(statement => statement.subject.value))
  })
})
