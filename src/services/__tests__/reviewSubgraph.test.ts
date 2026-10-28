import { describe, expect, it } from 'vitest'
import { graph, parse } from 'rdflib'
import { buildReviewSubgraph } from '@/services/browse/reviewSubgraph'
import { serializeGraph } from '@/services/rdf/rdfGenerator'

const EX = 'http://example.org/'

function fixture() {
  const store = graph()
  parse(`@prefix ex: <${EX}> .
    ex:a a ex:Building; ex:name "Alpha"; ex:stakeholder [ex:organization ex:org]; ex:location ex:place .
    ex:b a ex:Building; ex:name "Beta"; ex:stakeholder [ex:organization ex:otherOrg] .
    ex:org a ex:Organization; ex:name "XY Architects"; ex:project ex:b; ex:related ex:org .
    ex:otherOrg a ex:Organization; ex:name "Unrelated Architects" .
    ex:place a ex:Place; ex:country "AT"; ex:parent [ex:label "Parent"@en] .
    ex:unrelated ex:name "Unrelated record" .
  `, store, EX, 'text/turtle')
  return store
}

describe('Review filtered RDF subgraphs', () => {
  it('keeps matching roots, linked profiles and nested blank nodes without unrelated records or rejected roots', async () => {
    const store = fixture()
    const originalCount = store.statements.length
    const filtered = buildReviewSubgraph(store, [`${EX}a`], new Set([`${EX}b`]))
    const turtle = await serializeGraph(filtered)
    const parsed = graph()
    parse(turtle, parsed, EX, 'text/turtle')
    const subjects = new Set(parsed.statements.map(statement => statement.subject.value))
    expect(subjects).toContain(`${EX}a`)
    expect(subjects).toContain(`${EX}org`)
    expect(subjects).toContain(`${EX}place`)
    expect(subjects).not.toContain(`${EX}b`)
    expect(subjects).not.toContain(`${EX}otherOrg`)
    expect(subjects).not.toContain(`${EX}unrelated`)
    expect(parsed.statements.some(statement => statement.object.value === 'Parent' && statement.object.termType === 'Literal' && statement.object.language === 'en')).toBe(true)
    expect(parsed.statements.filter(statement => statement.subject.termType === 'BlankNode')).toHaveLength(2)
    expect(filtered.namespaces).toEqual(store.namespaces)
    expect(store.statements).toHaveLength(originalCount)
  })

  it('handles cycles and shared entities once, while retaining every selected root', () => {
    const store = fixture()
    const roots = [`${EX}a`, `${EX}b`, `${EX}a`]
    const filtered = buildReviewSubgraph(store, roots)
    expect(filtered.statements.filter(statement => statement.subject.value === `${EX}org`)).toHaveLength(4)
    expect(filtered.statements.some(statement => statement.subject.value === `${EX}b`)).toBe(true)
    expect(filtered.statements.some(statement => statement.subject.value === `${EX}unrelated`)).toBe(false)
  })

  it('returns an empty graph for no matches and follows only outgoing links', () => {
    const store = fixture()
    expect(buildReviewSubgraph(store, []).statements).toHaveLength(0)
    const filtered = buildReviewSubgraph(store, [`${EX}place`])
    expect(filtered.statements.some(statement => statement.subject.value === `${EX}a`)).toBe(false)
    expect(buildReviewSubgraph(store, ['urn:missing']).statements).toHaveLength(0)
  })
})
