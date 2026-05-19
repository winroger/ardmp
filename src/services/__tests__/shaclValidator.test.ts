import { describe, expect, it } from 'vitest'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { csvSource } from '@/test/dataSources'
import { validateMapping } from '@/services/validation/shaclValidator'
import { getEmbeddedExampleProjectSnapshot } from '@/services/project/loadEmbeddedExampleProject'
import { restoreDataSourcesFromSnapshot } from '@/services/project/projectSnapshot'

const SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:  <http://example.org/> .
@prefix dct: <http://purl.org/dc/terms/> .

ex:PersonShape a sh:NodeShape ;
  dct:title "Person" ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:name "Name" ; sh:path ex:name ;
    sh:datatype xsd:string ; sh:minCount 1
  ] ;
  sh:property [
    sh:name "Age" ; sh:path ex:age ;
    sh:datatype xsd:integer
  ] ;
  sh:property [
    sh:name "Email" ; sh:path ex:email ;
    sh:datatype xsd:string ;
    sh:pattern "^[^@]+@[^@]+$"
  ] .
`

const MALFORMED_LIST_SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix ex:  <http://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:BrokenShape a sh:NodeShape ;
  sh:targetClass ex:Broken ;
  sh:property [
    sh:path ex:status ;
    sh:datatype xsd:string ;
    sh:in ex:StatusA ;
  ] .
`

function makeAp(ttl = SHAPE) {
  const ap = new ApplicationProfile()
  ap.upsert(parseShaclProfile(ttl, 'test.ttl', 'uploaded'))
  return ap
}

describe('shaclValidator', () => {
  it('reports no violations for valid data', async () => {
    const ap = makeAp()
    const csv = csvSource('p', 'p.csv', ['id', 'Name', 'Age'], [['1', 'Alice', '30']])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'p', sourceHeader: 'Name', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/name' })
    mapping.addOrReplace({ sourceId: 'p', sourceHeader: 'Age', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/age' })
    const result = await validateMapping(ap, mapping, [csv])
    expect(result.violations).toHaveLength(0)
    expect(result.isValid).toBe(true)
  })

  it('reports error for minCount violation (empty required cell)', async () => {
    const ap = makeAp()
    const csv = csvSource('p', 'p.csv', ['id', 'Name'], [['1', '']])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'p', sourceHeader: 'Name', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/name' })
    const result = await validateMapping(ap, mapping, [csv])
    const errors = result.violations.filter(v => v.severity === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(result.isValid).toBe(false)
  })

  it('reports warning for unmapped required property', async () => {
    const ap = makeAp()
    const csv = csvSource('p', 'p.csv', ['id'], [['1']])
    const mapping = new MappingState()
    const result = await validateMapping(ap, mapping, [csv])
    const warnings = result.violations.filter(v => v.severity === 'warning')
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })

  it('reports error for invalid integer', async () => {
    const ap = makeAp()
    const csv = csvSource('p', 'p.csv', ['id', 'Age'], [['1', 'not-a-number']])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'p', sourceHeader: 'Age', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/age' })
    const result = await validateMapping(ap, mapping, [csv])
    const errors = result.violations.filter(v => v.severity === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('reports error for sh:pattern violation', async () => {
    const ap = makeAp()
    const csv = csvSource('p', 'p.csv', ['id', 'Email'], [['1', 'not-an-email']])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'p', sourceHeader: 'Email', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/email' })
    const result = await validateMapping(ap, mapping, [csv])
    const errors = result.violations.filter(v => v.severity === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('skips malformed list-based SHACL constraints without crashing', async () => {
    const ap = makeAp(MALFORMED_LIST_SHAPE)
    const csv = csvSource('p', 'p.csv', ['id', 'status'], [['1', 'StatusA']])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'p', sourceHeader: 'status', shapeIri: 'http://example.org/BrokenShape', propertyPath: 'http://example.org/status' })
    const result = await validateMapping(ap, mapping, [csv])
    const warnings = result.violations.filter(v => v.constraintComponent === 'MalformedShapeConstraint')
    expect(warnings.length).toBe(1)
    expect(result.isValid).toBe(true)
  })

  it('validates the minimal embedded showcase example without violations', async () => {
    const snapshot = getEmbeddedExampleProjectSnapshot()
    const ap = new ApplicationProfile()
    for (const profile of snapshot.shapeProfiles) {
      ap.upsert(parseShaclProfile(profile.rawTurtle, profile.source, 'embedded', profile.iri))
    }

    const mapping = new MappingState()
    for (const edge of snapshot.mapping.edges) {
      mapping.addOrReplace(edge)
    }

    const result = await validateMapping(ap, mapping, restoreDataSourcesFromSnapshot(snapshot.sources))

    expect(result.violations).toHaveLength(0)
    expect(result.isValid).toBe(true)
  })
})



