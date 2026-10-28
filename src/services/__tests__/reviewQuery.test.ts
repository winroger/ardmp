import { describe, expect, it } from 'vitest'
import { graph, parse } from 'rdflib'
import rdf from '@rdfjs/data-model'
import type { Query, QueryCriterion } from '@ulb-darmstadt/shacl-form'
import { ReviewQueryIndex, type QueryScope, type ReviewQueryField } from '@/services/browse/reviewQuery'

const EX = 'http://example.org/'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const iri = (value: string) => `${EX}${value}`
const literal = (value: string, datatype = 'string') => rdf.literal(value, rdf.namedNode(`${XSD}${datatype}`))
const scope: QueryScope = { key: 'stakeholder', depth: 1, classes: [], fixed: [] }
const role: ReviewQueryField = { id: 'role', path: [iri('stakeholder'), iri('role')], scopes: [scope] }
const organization: ReviewQueryField = { id: 'organization', path: [iri('stakeholder'), iri('organization'), iri('name')], scopes: [scope] }
const field = (name: string, datatype?: string): ReviewQueryField => ({ id: name, path: [iri(name)], datatype: datatype ? `${XSD}${datatype}` : undefined })
const contains = (field: ReviewQueryField, value: string): QueryCriterion => ({ field, operator: 'contains', value: literal(value) })
const equals = (field: ReviewQueryField, value: string): QueryCriterion => ({ field, operator: 'equals', value: rdf.namedNode(iri(value)) })
const query = (criteria: QueryCriterion[] = []): Query => ({ rootShapeId: iri('BuildingShape'), targetClass: iri('Building'), criteria })

function fixture() {
  const store = graph()
  parse(`
    @prefix ex: <${EX}> . @prefix xsd: <${XSD}> .
    ex:b1 a ex:Building; ex:name "Timber House"; ex:year 2001; ex:date "2001-02-03"^^xsd:date;
      ex:stakeholder [ex:role ex:Architect; ex:organization ex:orga], [ex:role ex:Contractor; ex:organization ex:orgb];
      ex:enabled true; ex:tag "wood", "wood", "city"; ex:description "Holzhaus"@de, "Timber house"@en-GB .
    ex:b2 a ex:Building; ex:name "School"; ex:year 2015; ex:date "2015-03-10"^^xsd:date;
      ex:stakeholder [ex:role ex:Architect; ex:organization ex:orga],
        [ex:role ex:Architect; ex:organization ex:orgb], [ex:role ex:Architect; ex:organization ex:orgb]; ex:tag "wood" .
    ex:b3 a ex:Building; ex:title "Tower"; ex:year "2020"; ex:date "invalid"^^xsd:date;
      ex:stakeholder [ex:role ex:Architect; ex:organization ex:orgb]; ex:enabled "true" .
    ex:orga a ex:Organization; ex:name "A Architects" . ex:orgb a ex:Organization; ex:name "B Architects" .
  `, store, EX, 'text/turtle')
  const roots = ['b1', 'b2', 'b3'].map(iri)
  return { store, roots, index: new ReviewQueryIndex(store, new Map([[iri('orgb'), 'B Architects']])) }
}

describe('Review query evaluation', () => {
  it('correlates role and organization criteria on the same stakeholder, including blank nodes and multiple values', () => {
    const { index, roots } = fixture()
    expect(index.matchingRoots({ query: query([equals(role, 'Architect'), contains(organization, 'B Architects')]), fields: [role, organization] }, roots))
      .toEqual(new Set(['b2', 'b3'].map(iri)))
  })

  it('applies fixed role constraints to nested branches without requiring a user to select the role', () => {
    const { index, roots } = fixture()
    const architect = { ...organization, scopes: [{ ...scope, key: 'architect', fixed: [{ path: iri('role'), value: rdf.namedNode(iri('Architect')) }] }] }
    expect(index.matchingRoots({ query: query([contains(architect, 'B Architects')]), fields: [architect] }, roots))
      .toEqual(new Set(['b2', 'b3'].map(iri)))
  })

  it('keeps qualified branches on the same predicate independent', () => {
    const { index, roots } = fixture()
    const branch = (id: string, role: string): ReviewQueryField => ({ ...organization, id,
      shapePath: [id, iri('organization'), iri('name')],
      scopes: [{ ...scope, key: id, fixed: [{ path: iri('role'), value: rdf.namedNode(iri(role)) }] }],
    })
    const architect = branch('architect', 'Architect')
    const contractor = branch('contractor', 'Contractor')
    expect(index.matchingRoots({ query: query([contains(architect, 'A Architects'), contains(contractor, 'B Architects')]), fields: [architect, contractor] }, roots))
      .toEqual(new Set([iri('b1')]))
  })

  it('applies explicit class restrictions to the bound nested resource', () => {
    const { index, roots } = fixture()
    const restricted = { ...organization, scopes: [{ ...scope, classes: [iri('SpecialStakeholder')] }] }
    expect(index.matchingRoots({ query: query([contains(restricted, 'Architects')]), fields: [restricted] }, roots).size).toBe(0)
  })

  it('matches names from the RDF graph, alternative paths, and case-insensitive text', () => {
    const { index, roots } = fixture()
    const name = { id: 'name', path: [[iri('name'), iri('title')]] }
    expect(index.matchingRoots({ query: query([contains(name, 'TOWER')]), fields: [name] }, roots)).toEqual(new Set([iri('b3')]))
    expect(index.matchingRoots({ query: query([contains(field('missing'), 'anything')]), fields: [] }, roots).size).toBe(0)
  })

  it('preserves RDF term types and language tags for equality and text matching', () => {
    const { index, roots } = fixture()
    const enabled = field('enabled')
    expect(index.matchingRoots({ query: query([{ field: enabled, operator: 'equals', value: literal('true', 'boolean') }]), fields: [enabled] }, roots)).toEqual(new Set([iri('b1')]))
    const description = field('description')
    expect(index.matchingRoots({ query: query([{ field: description, operator: 'contains', value: rdf.literal('Timber', 'en') }]), fields: [description] }, roots)).toEqual(new Set([iri('b1')]))
    expect(index.matchingRoots({ query: query([{ field: description, operator: 'contains', value: rdf.literal('Timber', 'de') }]), fields: [description] }, roots).size).toBe(0)
  })

  it('compares numeric and temporal bounds by value, without coercing strings or invalid dates', () => {
    const { index, roots } = fixture()
    const year = field('year', 'integer')
    expect(index.matchingRoots({ query: query([{ field: year, operator: 'range', min: literal('2010', 'integer'), max: literal('2030', 'integer') }]), fields: [year] }, roots)).toEqual(new Set([iri('b2')]))
    const date = field('date', 'date')
    expect(index.matchingRoots({ query: query([{ field: date, operator: 'range', min: literal('2010-01-01', 'date') }]), fields: [date] }, roots)).toEqual(new Set([iri('b2')]))
  })

  it('limits results to supplied roots and the root target class', () => {
    const { index, roots } = fixture()
    expect(index.matchingRoots({ query: query(), fields: [] }, [roots[0], iri('orga')])).toEqual(new Set([roots[0]]))
    expect(index.matchingRoots({ query: query(), fields: [] }, [])).toEqual(new Set())
  })
})

describe('Review facets', () => {
  it('counts distinct roots and values instead of matching stakeholder rows, with the same binding rules as results', () => {
    const { index, roots } = fixture()
    const facets = index.facets({ query: query([equals(role, 'Architect')]), fields: [role, organization] }, [...roots, roots[0]])
    expect(facets[1]).toMatchObject({ count: 3, buckets: [
      { value: literal('A Architects'), count: 2 }, { value: literal('B Architects'), count: 2 },
    ] })
    const limited = index.facets({ query: query([equals(role, 'Architect')]), fields: [organization, role] }, [roots[0]])
    expect(limited[0]).toMatchObject({ count: 1, buckets: [{ value: literal('A Architects'), count: 1 }] })
  })

  it('provides typed ranges, resource labels, and counts after external search filters', () => {
    const { index, roots } = fixture()
    const reference: ReviewQueryField = { ...organization, id: 'orgRef', path: [iri('stakeholder'), iri('organization')] }
    const facets = index.facets({ query: query(), fields: [field('year', 'integer'), field('date', 'date'), reference] }, [roots[0], roots[1]])
    expect(facets[0]).toMatchObject({ count: 2, min: literal('2001', 'integer'), max: literal('2015', 'integer') })
    expect(facets[1]).toMatchObject({ count: 2, min: literal('2001-02-03', 'date'), max: literal('2015-03-10', 'date') })
    expect(facets[2].buckets?.find(bucket => bucket.value.value === iri('orgb'))).toMatchObject({ label: 'B Architects', count: 2 })
  })

  it('keeps zero-result facets empty and honours cancelled requests', () => {
    const { index, roots } = fixture()
    expect(index.facets({ query: query(), fields: [field('missing')] }, roots)[0]).toEqual({ fieldId: 'missing', count: 0, buckets: [] })
    const controller = new AbortController()
    controller.abort()
    expect(() => index.facets({ query: query(), fields: [role] }, roots, controller.signal)).toThrow()
  })
})
