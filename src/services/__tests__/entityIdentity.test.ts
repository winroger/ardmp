import { describe, expect, it } from 'vitest'
import { namedNode } from 'rdflib'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { createNodeOutputTabularSource } from '@/domain/DataSource'
import { airtableSource, csvSource } from '@/test/dataSources'
import { generateRdf } from '@/services/rdf/rdfGenerator'
import { prepareEntityExport } from '@/services/mapping/entityExport'
import { subjectFor, sourcePathForExport } from '@/services/mapping/mappingSemantics'
import { buildRmlStore } from '@/services/export/rmlSerializer'
import { buildRoCratePackage } from '@/services/export/exportService'
import { stagingPropertyForColumn } from '@/services/mapping/stagingSemantics'

const EX = 'http://example.org/'
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const PROFILE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <http://example.org/> .
ex:BuildingShape a sh:NodeShape ; sh:targetClass ex:Building ;
  sh:property [ sh:path ex:buildingName ; sh:datatype xsd:string ] ;
  sh:property [ sh:path ex:location ; sh:node ex:LocationShape ] ;
  sh:property [ sh:path ex:stakeholder ; sh:node ex:StakeholderShape ] .
ex:LocationShape a sh:NodeShape ; sh:targetClass ex:Location ;
  sh:property [ sh:path ex:locationName ; sh:datatype xsd:string ] ;
  sh:property [ sh:path ex:geonamesId ; sh:datatype xsd:string ] .
ex:StakeholderShape a sh:NodeShape ; sh:targetClass ex:Stakeholder ;
  sh:property [ sh:path ex:stakeholderName ; sh:datatype xsd:string ] .
`

function setup() {
  const ap = new ApplicationProfile()
  const profile = parseShaclProfile(PROFILE, 'entities.ttl', 'uploaded')
  ap.upsert(profile)
  const source = csvSource('input', 'Buildings',
    ['row', 'building_id', 'geonames_id', 'stakeholder_id', 'building', 'location', 'stakeholder', 'location_fk'], [
      ['row1', 'B 1', '2950159', 'S1', 'Museum', 'Berlin', 'Alice', '2925533'],
      ['row2', 'B2', '2950159', 'S1', 'Library', 'Berlin', 'Alice', ''],
      ['row3', 'B3', '2925533', 'S2', 'Archive', 'Frankfurt', 'Bob', ''],
      ['row4', 'B4', '', '', 'Unknown', '', '', ''],
    ])
  const mapping = new MappingState()
  for (const [shape, column, identifier] of [
    ['Building', 'building', 'building_id'], ['Location', 'location', 'geonames_id'], ['Stakeholder', 'stakeholder', 'stakeholder_id'],
  ]) {
    mapping.addOrReplace({ sourceId: source.id, sourceHeader: column, shapeIri: `${EX}${shape}Shape`, propertyPath: `${EX}${column}Name` })
    mapping.setSubjectIdentifier(`${EX}${shape}Shape`, source.id, identifier)
  }
  return { ap, profile, source, mapping }
}

describe('profile entity identities', () => {
  it('creates three profiles from each row and shares repeated Location and Stakeholder identities', () => {
    const { ap, source, mapping } = setup()
    const store = generateRdf(ap, mapping, [source]).store
    const targets = (building: string, property: string) => store.each(namedNode(`${EX}Building/${building}`), namedNode(`${EX}${property}`)).map(term => term.value)
    expect(targets('B%201', 'location')).toEqual([`${EX}Location/2950159`])
    expect(targets('B2', 'location')).toEqual([`${EX}Location/2950159`])
    expect(targets('B3', 'location')).toEqual([`${EX}Location/2925533`])
    expect(targets('B2', 'stakeholder')).toEqual([`${EX}Stakeholder/S1`])
    expect(targets('B4', 'location')).toEqual([])
    expect(targets('B4', 'stakeholder')).toEqual([])
    expect(store.each(undefined, RDF_TYPE, namedNode(`${EX}Location`))).toHaveLength(2)
    expect(store.each(undefined, RDF_TYPE, namedNode(`${EX}Building`))).toHaveLength(4)
    expect(store.statements.some(statement => statement.subject.value === `${EX}Location/`)).toBe(false)
  })

  it('lets an explicit reference override the same-row Location', () => {
    const { ap, source, mapping } = setup()
    mapping.addOrReplace({ sourceId: source.id, sourceHeader: 'location_fk', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` })
    const store = generateRdf(ap, mapping, [source]).store
    expect(store.each(namedNode(`${EX}Building/B%201`), namedNode(`${EX}location`)).map(term => term.value)).toEqual([`${EX}Location/2925533`])
    expect(store.each(namedNode(`${EX}Building/B2`), namedNode(`${EX}location`))).toEqual([])
  })

  it('preserves Airtable linked record resolution when the target uses a different identifier', () => {
    const { ap } = setup()
    const buildings = airtableSource('buildings', 'Buildings', ['name', 'location'], [['Museum', ['recLOC', 'recEMPTY']]], ['recBUILD'])
    const locations = airtableSource('locations', 'Locations', ['id', 'name'], [[' 2950159 ', 'Berlin'], ['', 'Unknown']], ['recLOC', 'recEMPTY'])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: buildings.id, sourceHeader: 'name', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}buildingName` })
    mapping.addOrReplace({ sourceId: buildings.id, sourceHeader: 'location', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` })
    mapping.addOrReplace({ sourceId: locations.id, sourceHeader: 'name', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}locationName` })
    mapping.setSubjectIdentifier(`${EX}LocationShape`, locations.id, 'id')
    const store = generateRdf(ap, mapping, [buildings, locations]).store
    expect(store.each(namedNode(`${EX}Building/recBUILD`), namedNode(`${EX}location`)).map(term => term.value)).toEqual([`${EX}Location/2950159`])
    expect(locations.recordIds).toEqual(['recLOC', 'recEMPTY'])
    const prepared = prepareEntityExport(ap.findNodeShape(`${EX}BuildingShape`)!, buildings, ap, mapping, [buildings, locations])!
    expect(prepared.source.rows[0].at(-1)).toBe(`${EX}Location/2950159`)
  })

  it('links enriched rows by lineage and storage IDs, including reordered results and failed lookups', () => {
    const { ap, source, mapping } = setup()
    const output = createNodeOutputTabularSource({
      id: 'geo', name: 'GeoNames', provider: 'geonames', nodeId: 'geo-node', inputSourceId: source.id,
      headers: ['id', 'name'], rows: [[2925533, 'Frankfurt'], [2950159, 'Berlin'], [2950159, 'Berlin'], ['', '']],
      recordIds: ['row3', 'row1', 'row2', 'row4'],
    })
    mapping.addOrReplace({ sourceId: output.id, sourceHeader: 'name', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}locationName` })
    mapping.setSubjectIdentifier(`${EX}LocationShape`, output.id, 'id')
    const store = generateRdf(ap, mapping, [source, output]).store
    expect(store.any(namedNode(`${EX}Building/B%201`), namedNode(`${EX}location`))?.value).toBe(`${EX}Location/2950159`)
    expect(store.any(namedNode(`${EX}Building/B3`), namedNode(`${EX}location`))?.value).toBe(`${EX}Location/2925533`)
    expect(store.any(namedNode(`${EX}Building/B4`), namedNode(`${EX}location`))).toBeNull()
  })

  it('keeps CSV Building identities when GeoNames IDs feed sh:node references and deduplicates only Locations', async () => {
    const { ap, profile, source, mapping } = setup()
    const output = createNodeOutputTabularSource({
      id: 'geo', name: 'GeoNames', provider: 'geonames', nodeId: 'geo-node', inputSourceId: source.id,
      headers: ['id', 'name'], rows: [[2925533, 'Frankfurt'], [2950159, 'Berlin'], [2950159, 'Berlin'], ['', '']],
      recordIds: ['row3', 'row1', 'row2', 'row4'],
    })
    mapping.addOrReplace({ sourceId: output.id, sourceHeader: 'id', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` })
    mapping.addOrReplace({ sourceId: output.id, sourceHeader: 'id', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}geonamesId` })
    mapping.setSubjectIdentifier(`${EX}LocationShape`, output.id, 'id')
    const sources = [source, output]
    const rdf = generateRdf(ap, mapping, sources).store
    const buildings = rdf.each(undefined, RDF_TYPE, namedNode(`${EX}Building`)).map(term => term.value).sort()
    expect(buildings).toEqual(['B%201', 'B2', 'B3', 'B4'].map(id => `${EX}Building/${id}`).sort())
    expect(rdf.each(undefined, RDF_TYPE, namedNode(`${EX}Location`))).toHaveLength(2)
    for (const id of ['B%201', 'B2']) {
      expect(rdf.any(namedNode(`${EX}Building/${id}`), namedNode(`${EX}location`))?.value).toBe(`${EX}Location/2950159`)
      expect(rdf.any(namedNode(`${EX}Building/${id}`), namedNode(`${EX}buildingName`))).not.toBeNull()
    }
    expect(rdf.any(namedNode(`${EX}Building/B3`), namedNode(`${EX}location`))?.value).toBe(`${EX}Location/2925533`)
    expect(rdf.any(namedNode(`${EX}Building/B4`), namedNode(`${EX}location`))).toBeNull()
    expect(rdf.any(namedNode(`${EX}Location/2950159`), namedNode(`${EX}locationName`))?.value).toBe('Berlin')
    const shape = ap.findNodeShape(`${EX}BuildingShape`)!
    const prepared = prepareEntityExport(shape, output, ap, mapping, sources)!
    expect(prepared.source.rows.map(row => row[prepared.source.headers.indexOf(prepared.subjectHeader)])).toEqual(['B3', 'B%201', 'B2', 'B4'].map(id => `${EX}Building/${id}`))
    const rml = buildRmlStore(ap, mapping, sources)
    const path = sourcePathForExport(prepared.source)
    expect(rml.statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#source')).map(statement => statement.object.value)).toContain(path)
    const zip = await JSZip.loadAsync(await (await buildRoCratePackage({ projectTitle: 'Building locations', ap, profiles: [profile], sources, mapping })).blob.arrayBuffer())
    const rows = Papa.parse<Record<string, string>>(await zip.file(path)!.async('string'), { header: true, skipEmptyLines: true }).data
    const reference = prepared.referenceHeaders.get(`${EX}location`)!
    expect(rows.find(row => row[prepared.subjectHeader] === `${EX}Building/B2`)?.[reference]).toBe(`${EX}Location/2950159`)
    expect(rows.map(row => row[prepared.subjectHeader]).sort()).toEqual(buildings)
  })

  it('uses the selected GeoNames identity for every Location field and skips failed IDs without losing Buildings', () => {
    const { ap, source, mapping } = setup()
    const output = createNodeOutputTabularSource({
      id: 'geo', name: 'GeoNames', provider: 'geonames', nodeId: 'geo-node', inputSourceId: source.id,
      headers: ['id'], rows: [['2950159'], ['2950159'], [''], ['']], recordIds: ['row1', 'row2', 'row3', 'row4'],
    })
    mapping.addOrReplace({ sourceId: output.id, sourceHeader: 'id', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}geonamesId` })
    mapping.setSubjectIdentifier(`${EX}LocationShape`, output.id, 'id')
    const rdf = generateRdf(ap, mapping, [source, output]).store
    expect(rdf.each(undefined, RDF_TYPE, namedNode(`${EX}Building`))).toHaveLength(4)
    expect(rdf.each(undefined, RDF_TYPE, namedNode(`${EX}Location`)).map(term => term.value)).toEqual([`${EX}Location/2950159`])
    expect(rdf.any(namedNode(`${EX}Building/B3`), namedNode(`${EX}location`))).toBeNull()
    expect(rdf.any(namedNode(`${EX}Location/2950159`), namedNode(`${EX}locationName`))?.value).toBe('Berlin')
    const prepared = prepareEntityExport(ap.findNodeShape(`${EX}LocationShape`)!, source, ap, mapping, [source, output])!
    expect(prepared.source.rows).toHaveLength(2)
  })

  it('keeps the CSV default identity when GeoNames contributes Building properties', () => {
    const { ap, source, mapping } = setup()
    mapping.setSubjectIdentifier(`${EX}BuildingShape`, source.id)
    const output = createNodeOutputTabularSource({
      id: 'geo', name: 'GeoNames', provider: 'geonames', nodeId: 'geo-node', inputSourceId: source.id,
      headers: ['id'], rows: [['2950159'], ['2950159'], ['2925533'], ['']], recordIds: ['row1', 'row2', 'row3', 'row4'],
    })
    mapping.addOrReplace({ sourceId: output.id, sourceHeader: 'id', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` })
    const rdf = generateRdf(ap, mapping, [source, output]).store
    expect(rdf.each(undefined, RDF_TYPE, namedNode(`${EX}Building`)).map(term => term.value).sort()).toEqual(['row1', 'row2', 'row3', 'row4'].map(id => `${EX}Building/${id}`))
    expect(rdf.any(namedNode(`${EX}Building/row2`), namedNode(`${EX}location`))?.value).toBe(`${EX}Location/2950159`)
  })

  it('does not invent links between unrelated tables that happen to have matching row IDs', () => {
    const { ap, source, mapping } = setup()
    const other = csvSource('other', 'Other', ['row', 'name', 'id'], [['row1', 'Paris', '2988507']])
    mapping.addOrReplace({ sourceId: other.id, sourceHeader: 'name', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}locationName` })
    mapping.setSubjectIdentifier(`${EX}LocationShape`, other.id, 'id')
    expect(generateRdf(ap, mapping, [source, other]).store.each(undefined, namedNode(`${EX}location`))).toEqual([])
  })

  it('preserves defaults, encodes selected scalar IDs and rejects missing identifier columns', () => {
    const { ap, source, mapping } = setup()
    const shape = ap.findNodeShape(`${EX}BuildingShape`)!
    mapping.setSubjectIdentifier(shape.nodeId.value, source.id)
    expect(subjectFor(shape, source, source.rows[0], 0, mapping)?.value).toBe(`${EX}Building/row1`)
    mapping.setSubjectIdentifier(shape.nodeId.value, source.id, 'building_id')
    expect(subjectFor(shape, source, ['row', ' A/B #1 '], 0, mapping)?.value).toBe(`${EX}Building/A%2FB%20%231`)
    for (const value of [null, undefined, '', '  ', ['array'], { id: 1 }]) {
      expect(subjectFor(shape, source, ['row', value], 0, mapping)).toBeUndefined()
    }
    expect(subjectFor(shape, source, ['row', 0], 0, mapping)?.value).toBe(`${EX}Building/0`)
    mapping.setSubjectIdentifier(shape.nodeId.value, source.id, 'missing')
    expect(() => generateRdf(ap, mapping, [source])).toThrow('Subject identifier column "missing"')
  })

  it('uses custom identities for staging properties and joins staging links on the storage record ID', () => {
    const { ap } = setup()
    const records = ['recAAAAAAAAAAAAAA', 'recBBBBBBBBBBBBBB']
    const locations = airtableSource('locations', 'Locations', ['id', 'name', 'note'], [['2950159', 'Berlin', 'capital'], ['', 'Unknown', 'skip']], records)
    const buildings = airtableSource('buildings', 'Buildings', ['name', 'Locations'], [['Museum', records[0]], ['Unknown', records[1]]], ['recCCCCCCCCCCCCCC', 'recDDDDDDDDDDDDDD'])
    const mapping = new MappingState()
    mapping.addOrReplace({ sourceId: locations.id, sourceHeader: 'name', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}locationName` })
    mapping.addOrReplace({ sourceId: buildings.id, sourceHeader: 'name', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}buildingName` })
    mapping.setSubjectIdentifier(`${EX}LocationShape`, locations.id, 'id')
    const sources = [buildings, locations]
    const rdf = generateRdf(ap, mapping, sources).store
    expect(rdf.any(namedNode(`${EX}Location/2950159`), stagingPropertyForColumn(locations, 'note'))?.value).toBe('capital')
    expect(rdf.any(namedNode(`${EX}Building/recCCCCCCCCCCCCCC`), stagingPropertyForColumn(buildings, 'Locations'))?.value).toBe(`${EX}Location/2950159`)
    expect(rdf.any(namedNode(`${EX}Building/recDDDDDDDDDDDDDD`), stagingPropertyForColumn(buildings, 'Locations'))).toBeNull()
    const rml = buildRmlStore(ap, mapping, sources)
    const rr = (name: string) => namedNode(`http://www.w3.org/ns/r2rml#${name}`)
    expect(rml.statementsMatching(undefined, rr('parentTriplesMap'))).toHaveLength(1)
    const join = rml.statementsMatching(undefined, rr('joinCondition'))[0].object
    expect(join.termType).toBe('BlankNode')
    if (join.termType !== 'BlankNode') throw new Error('Expected a join condition')
    expect(rml.any(join, rr('child'))?.value).toBe('Locations')
    expect(rml.any(join, rr('parent'))?.value).toBe('_recordId')
  })

  it('uses the shape name as the URL segment when there is no target class', () => {
    const { source, mapping } = setup()
    const ap = new ApplicationProfile()
    ap.upsert(parseShaclProfile(PROFILE.replace('sh:targetClass ex:Building ;', ''), 'no-class.ttl', 'uploaded'))
    expect(subjectFor(ap.findNodeShape(`${EX}BuildingShape`)!, source, source.rows[0], 0, mapping)?.value).toBe(`${EX}BuildingShape/B%201`)
  })

  it('expands multiple explicit reference values in the RML source without changing input rows', () => {
    const { ap, mapping } = setup()
    const source = csvSource('input', 'Buildings', ['building_id', 'building', 'location_fk'], [['B1', 'Museum', ['2950159', '2925533']]])
    mapping.remove(`${EX}StakeholderShape`, `${EX}stakeholderName`)
    mapping.remove(`${EX}LocationShape`, `${EX}locationName`)
    mapping.addOrReplace({ sourceId: source.id, sourceHeader: 'location_fk', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` })
    const prepared = prepareEntityExport(ap.findNodeShape(`${EX}BuildingShape`)!, source, ap, mapping, [source])!
    expect(prepared.source.rows.map(row => row.at(-1))).toEqual([`${EX}Location/2950159`, `${EX}Location/2925533`])
    expect(source.rows).toHaveLength(1)
    expect(source.headers).toEqual(['building_id', 'building', 'location_fk'])
  })

  it('packages the exact RDF identities and references in the CSVs used by RML', async () => {
    const { ap, profile, source, mapping } = setup()
    const rdf = generateRdf(ap, mapping, [source]).store
    const rml = buildRmlStore(ap, mapping, [source])
    const result = await buildRoCratePackage({ projectTitle: 'Entities', ap, profiles: [profile], sources: [source], mapping })
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    for (const shape of ap.allNodeShapes()) {
      const prepared = prepareEntityExport(shape, source, ap, mapping, [source])!
      const path = sourcePathForExport(prepared.source)
      expect(rml.statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#source')).map(statement => statement.object.value)).toContain(path)
      const csv = await zip.file(path)!.async('string')
      const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data
      expect(rows).toHaveLength(shape.nodeId.value === `${EX}BuildingShape` ? 4 : 3)
      for (const row of rows) {
        const subject = namedNode(row[prepared.subjectHeader])
        expect(rdf.holds(subject, RDF_TYPE, shape.targetClass!)).toBe(true)
        for (const [property, header] of prepared.referenceHeaders) {
          if (row[header]) expect(rdf.holds(subject, namedNode(property), namedNode(row[header]))).toBe(true)
        }
      }
      const subjectMaps = rml.statementsMatching(undefined, namedNode('http://www.w3.org/ns/r2rml#subjectMap')).map(statement => statement.object)
      expect(subjectMaps.some(node => node.termType === 'BlankNode' && rml.any(node, namedNode('http://semweb.mmlab.be/ns/rml#reference'))?.value === prepared.subjectHeader)).toBe(true)
    }
    expect(zip.file(sourcePathForExport(source))).not.toBeNull()
  })
})
