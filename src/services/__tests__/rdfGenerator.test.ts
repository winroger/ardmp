import { describe, expect, it } from 'vitest'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { airtableSource, csvSource } from '@/test/dataSources'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'
import {
  createMinimalExportMapping,
  createMinimalExportProfile,
  createMinimalExportSource,
} from '@/services/__tests__/minimalExportFixture'

const SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex:  <http://example.org/> .

ex:PersonShape a sh:NodeShape ;
    dct:title "Person" ;
    sh:targetClass ex:Person ;
    sh:property [ sh:name "Name"  ; sh:path ex:name  ; sh:datatype xsd:string ] ;
    sh:property [ sh:name "Email" ; sh:path ex:email ; sh:datatype xsd:string ] .
`

/** Two shapes with a sh:node FK reference: Project → Person */
const FK_SHAPES = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex:  <http://example.org/> .

ex:PersonShape a sh:NodeShape ;
  dct:title "Person" ;
  sh:targetClass ex:Person ;
  sh:property [ sh:name "Name" ; sh:path ex:name ; sh:datatype xsd:string ] .

ex:ProjectShape a sh:NodeShape ;
  dct:title "Project" ;
  sh:targetClass ex:Project ;
  sh:property [ sh:name "Title" ; sh:path ex:title ; sh:datatype xsd:string ] ;
  sh:property [ sh:name "Owner" ; sh:path ex:owner ; sh:node ex:PersonShape ] .
`

const IRI_SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex:  <http://example.org/> .
@prefix schema: <http://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:ResourceShape a sh:NodeShape ;
  dct:title "Resource" ;
  sh:targetClass rdfs:Resource ;
  sh:property [ sh:name "URL" ; sh:path schema:url ; sh:nodeKind sh:IRI ] .
`

const GEO_SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix ex:  <http://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:PlaceShape a sh:NodeShape ;
  dct:title "Place" ;
  sh:targetClass ex:Place ;
  sh:property [ sh:name "Geometry" ; sh:path geo:asWKT ; sh:datatype geo:wktLiteral ] ;
  sh:property [ sh:name "GeoNames URI" ; sh:path dct:identifier ; sh:nodeKind sh:IRI ] ;
  sh:property [ sh:name "GeoNames ID" ; sh:path ex:geonamesId ; sh:datatype xsd:string ] ;
  sh:property [ sh:name "Place label" ; sh:path rdfs:label ; sh:datatype xsd:string ] .
`

describe('rdfGenerator', () => {
  it('generates one subject per CSV row with a type and mapped properties', async () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(SHAPE, 'shape.ttl', 'uploaded'))

    const csv = csvSource('people', 'people.csv',
      ['id', 'Name', 'Email'],
      [
        ['p1', 'Alice', 'alice@example.org'],
        ['p2', 'Bob',   'bob@example.org'],
      ],
    )

    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'people', sourceHeader: 'Name',  shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/name'  })
    mapping.addOrReplace({ sourceId: 'people', sourceHeader: 'Email', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/email' })

    const result = generateRdf(ap, mapping, [csv])
    expect(result.subjectCount).toBe(2)
    expect(result.tripleCount).toBeGreaterThanOrEqual(6) // 2 type + 2 name + 2 email

    const ttl = await serializeGraph(result.store, 'text/turtle')
    expect(ttl).toContain('Alice')
    expect(ttl).toContain('bob@example.org')
    expect(ttl).toContain('Person')
  })

  it('skips empty cells', () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(SHAPE, 'shape.ttl', 'uploaded'))
    const csv = csvSource('people', 'people.csv',
      ['id', 'Name', 'Email'],
      [['p1', 'Alice', '']],
    )
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'people', sourceHeader: 'Email', shapeIri: 'http://example.org/PersonShape', propertyPath: 'http://example.org/email' })
    const result = generateRdf(ap, mapping, [csv])
    // 1 rdf:type triple, 0 email triples (empty cell)
    expect(result.tripleCount).toBe(1)
  })

  it('builds FK object IRIs using targetClass, not nodeShape IRI', async () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(FK_SHAPES, 'fk.ttl', 'uploaded'))

    // People source (record IDs are the primary keys)
    const people = airtableSource('people', 'People', ['Name'], [['Alice']], ['recAAA'])
    // Projects source — Owner column contains Airtable record ID of linked person
    const projects = airtableSource('projects', 'Projects', ['Title', 'Owner'], [['My Project', 'recAAA']], ['recPRJ'])

    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'people',   sourceHeader: 'Name',  shapeIri: 'http://example.org/PersonShape',  propertyPath: 'http://example.org/name' })
    mapping.addOrReplace({ sourceId: 'projects',  sourceHeader: 'Title', shapeIri: 'http://example.org/ProjectShape', propertyPath: 'http://example.org/title' })
    mapping.addOrReplace({ sourceId: 'projects',  sourceHeader: 'Owner', shapeIri: 'http://example.org/ProjectShape', propertyPath: 'http://example.org/owner' })

    const result = generateRdf(ap, mapping, [people, projects])
    const ttl = await serializeGraph(result.store, 'text/turtle')

    // rdflib abbreviates ex:Person/recAAA as a prefixed name (e.g. Per:recAAA).
    // The critical assertion: the object IRI must NOT be the NodeShape IRI
    // (ex:PersonShape/recAAA) — it must be the targetClass IRI (ex:Person/…).
    expect(ttl).toContain('recAAA') // IRI exists in output
    expect(ttl).not.toContain('PersonShape') // NodeShape IRI must not leak into triples
    // The prefix declaration reveals the correct namespace was used
    expect(ttl).toContain('http://example.org/Person/')
  })

  it('handles Airtable array linked-record fields (multiple linked records)', async () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(FK_SHAPES, 'fk.ttl', 'uploaded'))

    const people = airtableSource('people', 'People', ['Name'], [['Alice'], ['Bob']], ['recA', 'recB'])
    // Owner field contains an array of two linked record IDs
    const projects = airtableSource('projects', 'Projects', ['Title', 'Owner'], [['Collab', ['recA', 'recB']]], ['recPRJ'])

    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: 'people',   sourceHeader: 'Name',  shapeIri: 'http://example.org/PersonShape',  propertyPath: 'http://example.org/name' })
    mapping.addOrReplace({ sourceId: 'projects',  sourceHeader: 'Title', shapeIri: 'http://example.org/ProjectShape', propertyPath: 'http://example.org/title' })
    mapping.addOrReplace({ sourceId: 'projects',  sourceHeader: 'Owner', shapeIri: 'http://example.org/ProjectShape', propertyPath: 'http://example.org/owner' })

    const result = generateRdf(ap, mapping, [people, projects])
    const ttl = await serializeGraph(result.store, 'text/turtle')

    // rdflib abbreviates IRIs; check that both record IDs appear as objects
    // (the array field was expanded into two separate triples)
    expect(ttl).toContain('Per:recA')
    expect(ttl).toContain('Per:recB')
  })

  it('emits sh:IRI properties as RDF IRIs instead of string literals', () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(IRI_SHAPE, 'iri.ttl', 'uploaded'))

    const csv = csvSource('resources', 'resources.csv',
      ['id', 'URL'],
      [['r1', 'https://www.fastepp.com/portfolio/fast-epp-home-office/']],
    )

    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: 'resources',
      sourceHeader: 'URL',
      shapeIri: 'http://example.org/ResourceShape',
      propertyPath: 'http://schema.org/url',
    })

    const result = generateRdf(ap, mapping, [csv])
    const statements = result.store.match(undefined, undefined, undefined, undefined)
    const urlStatement = statements.find(statement => statement.predicate.value === 'http://schema.org/url')

    expect(urlStatement?.object.termType).toBe('NamedNode')
    expect(urlStatement?.object.value).toBe('https://www.fastepp.com/portfolio/fast-epp-home-office/')
  })

  it('builds WKT literals from lat/lng transform mappings', async () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(GEO_SHAPE, 'geo.ttl', 'uploaded'))

    const csv = csvSource('places', 'places.csv',
      ['id', 'lat', 'lng'],
      [['p1', '49.8728', '8.6512']],
    )

    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: 'places',
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://www.opengis.net/ont/geosparql#asWKT',
      transform: 'lat-lng-to-wkt',
      transformNodeId: 'transform:test',
    })

    const result = generateRdf(ap, mapping, [csv])
    const ttl = await serializeGraph(result.store, 'text/turtle')

    expect(ttl).toContain('POINT(8.6512 49.8728)')
  })

  it('merges table attributes with GeoNames attributes and WKT for one location shape', async () => {
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(GEO_SHAPE, 'geo.ttl', 'uploaded'))

    const table = csvSource('locations', 'locations.csv',
      ['id', 'uri', 'geonamesId'],
      [['loc-1', 'https://www.geonames.org/5746545', '5746545']],
    )
    const geonames = airtableSource('geonames-output:node-1', 'GeoNames node-1',
      ['name', 'id', 'lat', 'lng'],
      [['Portland', '5746545', '45.52345', '-122.67621']],
      ['loc-1'],
    )

    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: 'locations',
      sourceHeader: 'uri',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://purl.org/dc/terms/identifier',
    })
    mapping.addOrReplace({
      sourceId: 'locations',
      sourceHeader: 'geonamesId',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://example.org/geonamesId',
    })
    mapping.addOrReplace({
      sourceId: 'geonames-output:node-1',
      sourceHeader: 'name',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://www.w3.org/2000/01/rdf-schema#label',
      source: { kind: 'node-output', provider: 'geonames', nodeId: 'geonames:node-1' },
    })
    mapping.addOrReplace({
      sourceId: 'geonames-output:node-1',
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://www.opengis.net/ont/geosparql#asWKT',
      transform: 'lat-lng-to-wkt',
      transformNodeId: 'transform:test',
    })

    const result = generateRdf(ap, mapping, [table, geonames])
    const ttl = await serializeGraph(result.store, 'text/turtle')

    expect(ttl).toContain('Portland')
    expect(ttl).toContain('5746545')
    expect(ttl).toContain('@prefix www: <https://www.geonames.org/>.')
    expect(ttl).toContain('dct:identifier www:5746545')
    expect(ttl).toContain('POINT(-122.67621 45.52345)')
  })

  it('generates the expected minimal export RDF fixture triples', async () => {
    const ap = new ApplicationProfile()
    const profile = createMinimalExportProfile()
    ap.upsert(profile)

    const result = generateRdf(ap, createMinimalExportMapping(), [createMinimalExportSource()])
    const ttl = await serializeGraph(result.store, 'text/turtle')

    expect(result.subjectCount).toBe(2)
    expect(result.tripleCount).toBe(8)
    expect(ttl).toContain('http://example.org/Building/')
    expect(ttl).toContain('Building A')
    expect(ttl).toContain('Building B')
    expect(ttl).toContain('2020')
    expect(ttl).toContain('2021')
    expect(ttl).toContain('schema:url')
    expect(ttl).toContain('building-a')
    expect(ttl).toContain('building-b')
    expect(ttl).toContain('xsd:gYear')
  })
})




