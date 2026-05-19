import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { airtableSource, csvSource } from '@/test/dataSources'
import { MappingState } from '@/domain/Mapping'
import { buildRoCratePackage } from '@/services/export/exportService'
import {
  createMinimalExportMapping,
  createMinimalExportProfile,
  createMinimalExportSource,
  readMinimalExportFixture,
} from '@/services/__tests__/minimalExportFixture'

const SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex:  <http://example.org/> .

ex:PersonShape a sh:NodeShape ;
  dct:title "Person" ;
  dct:description "Person profile description"@en ;
  sh:targetClass ex:Person ;
  sh:property [ sh:name "Name" ; sh:path ex:name ; sh:datatype xsd:string ] .
`

const GEO_SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix ex:  <http://example.org/> .

ex:PlaceShape a sh:NodeShape ;
  dct:title "Place" ;
  sh:targetClass ex:Place ;
  sh:property [ sh:name "Geometry" ; sh:path geo:asWKT ; sh:datatype geo:wktLiteral ] .
`

describe('exportService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes RML and Airtable record IDs into the RO-Crate bundle without mapping.json', async () => {
    const ap = new ApplicationProfile()
    const profile = parseShaclProfile(SHAPE, 'shape.ttl', 'uploaded')
    ap.upsert(profile)

    const source = airtableSource('people', 'People', ['Name'], [['Alice']], ['recAAA'])
    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: 'people',
      sourceHeader: 'Name',
      shapeIri: 'http://example.org/PersonShape',
      propertyPath: 'http://example.org/name',
    })

    const result = await buildRoCratePackage({
      projectTitle: 'People export',
      ap,
      profiles: [profile],
      sources: [source],
      mapping,
    })

    expect(result.filename).toMatch(/\.zip$/)

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const rml = await zip.file('mapping/mapping.rml.ttl')?.async('string')
    const sourceCsv = await zip.file('sources/People.csv')?.async('string')
    const roCrateJson = await zip.file('ro-crate-metadata.json')?.async('string')

    expect(rml).toContain('rml:source "sources/People.csv"')
    expect(rml).toContain('rr:template "http://example.org/Person/{_recordId}"')
    expect(zip.file('mapping/mapping.json')).toBeNull()
    expect(sourceCsv).toContain('_recordId,Name')
    expect(sourceCsv).toContain('recAAA,Alice')

    const roCrate = JSON.parse(roCrateJson ?? '{}')
    const ids = (roCrate['@graph'] as Array<{ '@id': string }>).map(entity => entity['@id'])
    expect(ids).toContain('mapping/mapping.rml.ttl')
    expect(ids).not.toContain('mapping/mapping.json')
  })

  it('derives RO-Crate root metadata from the dataset metadata turtle and promotes ORCID to creator @id', async () => {
    const ap = new ApplicationProfile()
    const profile = parseShaclProfile(SHAPE, 'shape.ttl', 'uploaded')
    ap.upsert(profile)

    const source = airtableSource('people', 'People', ['Name'], [['Alice']], ['recAAA'])
    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: 'people',
      sourceHeader: 'Name',
      shapeIri: 'http://example.org/PersonShape',
      propertyPath: 'http://example.org/name',
    })

    const metadataTurtle = `
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<http://example.org/dataset> a dcat:Dataset ;
  dct:title "Derived crate title" ;
  dct:description "Derived crate description" ;
  dct:issued "2026-05-12" ;
  dct:license <http://creativecommons.org/licenses/by/4.0/> ;
  prov:qualifiedAttribution _:att1 .

_:att1 prov:agent _:alice .
_:alice a foaf:Person ;
  foaf:name "Alice Example" ;
  dct:identifier "https://orcid.org/0000-0001-2345-6789" .
`

    const result = await buildRoCratePackage({
      projectTitle: 'Fallback title',
      ap,
      profiles: [profile],
      sources: [source],
      mapping,
      metadataTurtle,
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const roCrateJson = await zip.file('ro-crate-metadata.json')?.async('string')
    const roCrate = JSON.parse(roCrateJson ?? '{}')
    const root = roCrate['@graph'].find((entity: { '@id': string }) => entity['@id'] === './')
    const creator = roCrate['@graph'].find((entity: { '@id': string }) => entity['@id'] === 'https://orcid.org/0000-0001-2345-6789')

    expect(root.name).toBe('Derived crate title')
    expect(root.description).toBe('Derived crate description')
    expect(root.datePublished).toBe('2026-05-12')
    expect(root.license).toEqual({ '@id': 'http://creativecommons.org/licenses/by/4.0/' })
    expect(root.creator).toEqual({ '@id': 'https://orcid.org/0000-0001-2345-6789' })
    expect(creator.name).toBe('Alice Example')
  })

  it('adds SHACL profile descriptions to file metadata and uses them as description fallback', async () => {
    const ap = new ApplicationProfile()
    const profile = parseShaclProfile(SHAPE, 'shape.ttl', 'uploaded')
    ap.upsert(profile)

    const source = airtableSource('people', 'People', ['Name'], [['Alice']], ['recAAA'])
    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: 'people',
      sourceHeader: 'Name',
      shapeIri: 'http://example.org/PersonShape',
      propertyPath: 'http://example.org/name',
    })

    const result = await buildRoCratePackage({
      projectTitle: 'Fallback title',
      ap,
      profiles: [profile],
      sources: [source],
      mapping,
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const roCrateJson = await zip.file('ro-crate-metadata.json')?.async('string')
    const roCrate = JSON.parse(roCrateJson ?? '{}')
    const root = roCrate['@graph'].find((entity: { '@id': string }) => entity['@id'] === './')
    const shapeFile = roCrate['@graph'].find((entity: { '@id': string }) => entity['@id'] === 'shapes/PersonShape.ttl')

    expect(root.description).toContain('Person profile description')
    expect(shapeFile.name).toBe('Person')
    expect(shapeFile.description).toBe('Person profile description')
  })

  it('writes the expected RO-Crate package structure for the minimal export fixture', async () => {
    const profile = createMinimalExportProfile()
    const ap = new ApplicationProfile()
    ap.upsert(profile)
    const source = createMinimalExportSource()
    const mapping = createMinimalExportMapping()

    const result = await buildRoCratePackage({
      projectTitle: 'Minimal export fixture',
      ap,
      profiles: [profile],
      sources: [source],
      mapping,
      metadataTurtle: readMinimalExportFixture('metadata.ttl'),
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const zipPaths = Object.keys(zip.files)
      .filter(file => !file.endsWith('/'))
      .sort()
    const expectedPaths = [
      'README.md',
      'data/dataset.ttl',
      'mapping/mapping.rml.ttl',
      'ro-crate-metadata.json',
      'shapes/BuildingShape.ttl',
      'sources/source_csv.csv',
    ]

    expect(zipPaths).toEqual(expectedPaths)

    const roCrateJson = await zip.file('ro-crate-metadata.json')?.async('string')
    const datasetTtl = await zip.file('data/dataset.ttl')?.async('string')
    const sourceCsv = await zip.file('sources/source_csv.csv')?.async('string')

    expect(roCrateJson).toBeTruthy()
    expect(datasetTtl).toContain('Building A')
    expect(datasetTtl?.trimStart().startsWith('@prefix dcat:')).toBe(true)
    expect(sourceCsv).toContain('id,Name,Year,Website')

    const roCrate = JSON.parse(roCrateJson ?? '{}')
    const expectedRoCrate = JSON.parse(readMinimalExportFixture('expected-ro-crate-metadata.json'))
    const graph = roCrate['@graph'] as Array<Record<string, unknown>>
    const root = graph.find(entity => entity['@id'] === './')
    const expectedRoot = (expectedRoCrate['@graph'] as Array<Record<string, unknown>>)
      .find(entity => entity['@id'] === './')
    const fileIds = graph.map(entity => entity['@id']).filter((id): id is string => typeof id === 'string')

    expect(root).toMatchObject({
      '@id': './',
      '@type': 'Dataset',
      name: expectedRoot?.name,
      description: expectedRoot?.description,
      datePublished: expectedRoot?.datePublished,
    })
    expect(Array.isArray((root as { hasPart?: unknown[] } | undefined)?.hasPart)).toBe(true)
    expect((root as { hasPart: Array<{ '@id': string }> }).hasPart.map(part => part['@id']).sort())
      .toEqual(expectedPaths.filter(file => file !== 'ro-crate-metadata.json').sort())
    expect(fileIds).toEqual(expect.arrayContaining(expectedPaths))
    expect(fileIds).not.toContain('mapping/mapping.json')
  })

  it('exports a materialized transform output CSV alongside source and enrichment tables', async () => {
    const ap = new ApplicationProfile()
    const profile = parseShaclProfile(GEO_SHAPE, 'geo.ttl', 'uploaded')
    ap.upsert(profile)

    const source = csvSource(
      'places',
      'places.csv',
      ['id', 'lat', 'lng'],
      [['p1', '49.8728', '8.6512']],
    )
    const mapping = new MappingState()
    mapping.addOrReplace({
      sourceId: source.id,
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://www.opengis.net/ont/geosparql#asWKT',
      transform: 'lat-lng-to-wkt',
      transformNodeId: 'transform:test',
    })

    const result = await buildRoCratePackage({
      projectTitle: 'Transform export fixture',
      ap,
      profiles: [profile],
      sources: [source],
      mapping,
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const transformCsv = await zip.file('sources/lat-lng-to-wkt_transform_test.csv')?.async('string')
    const roCrateJson = await zip.file('ro-crate-metadata.json')?.async('string')
    const ids = (JSON.parse(roCrateJson ?? '{}')['@graph'] as Array<{ '@id': string }>).map(entity => entity['@id'])

    expect(transformCsv).toContain('wkt')
    expect(transformCsv).toContain('POINT(8.6512 49.8728)')
    expect(ids).toContain('sources/lat-lng-to-wkt_transform_test.csv')
  })
})



