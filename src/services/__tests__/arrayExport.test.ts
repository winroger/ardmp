import { beforeEach, describe, expect, it, vi } from 'vitest'
import { namedNode } from 'rdflib'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { airtableSource, csvSource } from '@/test/dataSources'
import { generateRdf } from '@/services/rdf/rdfGenerator'
import { buildRoCratePackage } from '@/services/export/exportService'
import { buildRmlStore } from '@/services/export/rmlSerializer'
import { prepareEntityExport, prepareStagingExport } from '@/services/mapping/entityExport'
import { sourcePathForExport } from '@/services/mapping/mappingSemantics'
import { stagingPropertyForColumn, stagingSubjectForRow } from '@/services/mapping/stagingSemantics'
import { createSplitNode, updateSplitNode } from '@/features/mapping/extensions/modules/nodes/split/workflow'
import { splitModule } from '@/features/mapping/extensions/modules/nodes/split'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'

const EX = 'http://example.org/'
const PROFILE = `
@prefix ex: <http://example.org/> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
ex:PlaceShape a sh:NodeShape ; sh:targetClass ex:Place ;
 sh:property [ sh:path ex:tag ; sh:datatype xsd:string ] ;
 sh:property [ sh:path ex:url ; sh:nodeKind sh:IRI ] ;
 sh:property [ sh:path ex:owner ; sh:node ex:PersonShape ] .
ex:PersonShape a sh:NodeShape ; sh:targetClass ex:Person ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] .
`

function setup() {
  const ap = new ApplicationProfile()
  const profile = parseShaclProfile(PROFILE, 'arrays.ttl', 'uploaded')
  ap.upsert(profile)
  return { ap, profile }
}

describe('array export', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('preserves array boundaries in archived CSVs and exports individual literals, IRIs and references for RML', async () => {
    const { ap, profile } = setup()
    const source = airtableSource('places', 'Places', ['tags', 'urls', 'owners'], [
      [['A,B', 'C'], ['https://example.org/a', 'https://example.org/b'], ['recA', 'recB']],
      [[], [], []],
    ], ['rec1', 'rec2'])
    const people = airtableSource('people', 'People', ['name'], [['Alice'], ['Bob']], ['recA', 'recB'])
    const sources = [source, people]
    const mapping = new MappingState()
    for (const [header, property] of [['tags', 'tag'], ['urls', 'url'], ['owners', 'owner']]) mapping.addOrReplace({ sourceId: source.id, sourceHeader: header, shapeIri: `${EX}PlaceShape`, propertyPath: `${EX}${property}` })
    mapping.addOrReplace({ sourceId: people.id, sourceHeader: 'name', shapeIri: `${EX}PersonShape`, propertyPath: `${EX}name` })
    const rdf = generateRdf(ap, mapping, sources).store
    const subject = namedNode(`${EX}Place/rec1`)
    expect(rdf.each(subject, namedNode(`${EX}tag`)).map(term => term.value).sort()).toEqual(['A,B', 'C'])
    expect(rdf.each(subject, namedNode(`${EX}url`)).every(term => term.termType === 'NamedNode')).toBe(true)
    expect(rdf.each(subject, namedNode(`${EX}owner`)).map(term => term.value).sort()).toEqual([`${EX}Person/recA`, `${EX}Person/recB`])
    const prepared = prepareEntityExport(ap.findNodeShape(`${EX}PlaceShape`)!, source, ap, mapping, sources)!
    expect(prepared.source.rows).toHaveLength(3) // two values per property, plus one empty row
    const zip = await JSZip.loadAsync(await (await buildRoCratePackage({ projectTitle: 'Arrays', ap, profiles: [profile], sources, mapping })).blob.arrayBuffer())
    const original = Papa.parse<Record<string, string>>(await zip.file(sourcePathForExport(source))!.async('string'), { header: true, skipEmptyLines: true }).data
    expect(JSON.parse(original[0].tags)).toEqual(['A,B', 'C'])
    expect(JSON.parse(original[1].tags)).toEqual([])
    const path = sourcePathForExport(prepared.source)
    const rows = Papa.parse<Record<string, string>>(await zip.file(path)!.async('string'), { header: true, skipEmptyLines: true }).data
    const reference = prepared.referenceHeaders.get(`${EX}owner`)!
    for (const row of rows.filter(row => row._recordId === 'rec1')) {
      const rowSubject = namedNode(row[prepared.subjectHeader])
      expect(rdf.each(rowSubject, namedNode(`${EX}tag`)).some(term => term.value === row.tags)).toBe(true)
      expect(rdf.holds(rowSubject, namedNode(`${EX}owner`), namedNode(row[reference]))).toBe(true)
    }
    const rml = buildRmlStore(ap, mapping, sources)
    expect(rml.statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#source')).map(statement => statement.object.value)).toContain(path)
    expect(rml.statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#reference')).map(statement => statement.object.value)).toContain(reference)
    expect(source.rows[0][0]).toEqual(['A,B', 'C'])
  })

  it('exports unmapped Airtable arrays as repeated staging properties with matching scalar CSV rows', async () => {
    const ap = new ApplicationProfile()
    const source = airtableSource('tags', 'Tags', ['tags'], [[['A,B', 'C']], [[]]], ['rec1', 'rec2'])
    const mapping = new MappingState()
    const rdf = generateRdf(ap, mapping, [source]).store
    expect(rdf.each(stagingSubjectForRow(source, 0)!, stagingPropertyForColumn(source, 'tags')).map(term => term.value)).toEqual(['A,B', 'C'])
    expect(rdf.each(stagingSubjectForRow(source, 1)!, stagingPropertyForColumn(source, 'tags'))).toEqual([])
    const prepared = prepareStagingExport(source, ap, mapping, [source])!
    expect(prepared.source.rows).toHaveLength(3)
    const zip = await JSZip.loadAsync(await (await buildRoCratePackage({ projectTitle: 'Staging arrays', ap, profiles: [], sources: [source], mapping })).blob.arrayBuffer())
    expect(zip.file(sourcePathForExport(prepared.source))).not.toBeNull()
    expect(buildRmlStore(ap, mapping, [source]).statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#source')).map(statement => statement.object.value)).toContain(sourcePathForExport(prepared.source))
  })

  it('exports split array outputs as multiple values on the original entity with stable empty rows', async () => {
    const { ap, profile } = setup()
    const dataStore = useDataStore()
    const mappingStore = useMappingStore()
    const source = csvSource('input', 'Input', ['id', 'text'], [['p1', 'Berlin|Germany'], ['p2', '']], ['r1', 'r2'])
    dataStore.upsertSource(source)
    const node = createSplitNode(mappingStore)
    const context = { dataStore, mappingStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    updateSplitNode(node.id, { mode: 'array', separator: '|' }, context)
    const handler = splitModule.connectionHandlers![0]!
    handler.connect({ source: 'src:input', sourceHandle: 'h:text', target: node.id, targetHandle: 'split-input' }, context)
    handler.connect({ source: node.id, sourceHandle: 'h:values', target: `shape:${EX}PlaceShape`, targetHandle: `p:${EX}tag` }, context)
    const rdf = generateRdf(ap, mappingStore.state, dataStore.sources).store
    expect(rdf.each(namedNode(`${EX}Place/r1`), namedNode(`${EX}tag`)).map(term => term.value)).toEqual(['Berlin', 'Germany'])
    expect(rdf.each(namedNode(`${EX}Place/r2`), namedNode(`${EX}tag`))).toEqual([])
    const output = dataStore.findById(`split-output:${node.id}`)!
    const zip = await JSZip.loadAsync(await (await buildRoCratePackage({ projectTitle: 'Split', ap, profiles: [profile], sources: dataStore.sources, mapping: mappingStore.state })).blob.arrayBuffer())
    const rows = Papa.parse<Record<string, string>>(await zip.file(sourcePathForExport(output))!.async('string'), { header: true, skipEmptyLines: true }).data
    expect(JSON.parse(rows[0].values)).toEqual(['Berlin', 'Germany'])
    expect(rows.map(row => row._recordId)).toEqual(['r1', 'r2'])
    expect(JSON.parse(rows[1].values)).toEqual([])
  })
})
