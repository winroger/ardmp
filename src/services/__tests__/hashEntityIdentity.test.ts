import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { namedNode } from 'rdflib'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { hashModule } from '@/features/mapping/extensions/modules/nodes/hash'
import { createHashNode } from '@/features/mapping/extensions/modules/nodes/hash/workflow'
import { splitModule } from '@/features/mapping/extensions/modules/nodes/split'
import { createSplitNode, updateSplitNode } from '@/features/mapping/extensions/modules/nodes/split/workflow'
import { generateRdf } from '@/services/rdf/rdfGenerator'
import { prepareEntityExport } from '@/services/mapping/entityExport'
import { inheritReferenceIdentifiers } from '@/services/mapping/referenceIdentifiers'
import { sourcePathForExport } from '@/services/mapping/mappingSemantics'
import { buildRoCratePackage } from '@/services/export/exportService'
import { buildRmlStore } from '@/services/export/rmlSerializer'

const EX = 'http://example.org/'
const TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const PROFILE = `
@prefix ex: <http://example.org/> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
ex:BuildingShape a sh:NodeShape ; sh:targetClass ex:Building ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] ;
 sh:property [ sh:path ex:architect ; sh:node ex:ArchitectShape ] .
ex:ArchitectShape a sh:NodeShape ; sh:targetClass ex:Architect ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] .
`

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe('hashed entity identifiers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each(['scalar', 'array'])('uses %s HASH output as the inherited Architect identifier while keeping names, Building IDs, and archive references', async mode => {
    const ap = new ApplicationProfile()
    const profile = parseShaclProfile(PROFILE, 'architects.ttl', 'uploaded')
    ap.upsert(profile)
    const dataStore = useDataStore()
    const mappingStore = useMappingStore()
    const source = csvSource('buildings', 'Buildings', ['id', 'name', 'architect'], [
      ['B1', 'Museum', mode === 'array' ? 'XY Architects|Other Architects|XY Architects' : 'XY Architects'],
      ['B2', 'Library', 'XY Architects'], ['B3', 'Unknown', ''],
    ], ['r1', 'r2', 'r3'])
    dataStore.upsertSource(source)
    const context = { dataStore, mappingStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    let nameSource = source
    let nameNode = `src:${source.id}`
    let nameHeader = 'architect'
    if (mode === 'array') {
      const split = createSplitNode(mappingStore)
      updateSplitNode(split.id, { mode: 'array', separator: '|' }, context)
      splitModule.connectionHandlers![0].connect({ source: `src:${source.id}`, sourceHandle: 'h:architect', target: split.id, targetHandle: 'split-input' }, context)
      nameNode = split.id
      nameHeader = 'values'
      nameSource = dataStore.findById(`split-output:${split.id}`)!
    }
    mappingStore.set({ sourceId: source.id, sourceHeader: 'name', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}name` })
    mappingStore.state.setSubjectIdentifier(`${EX}BuildingShape`, source.id, 'id')
    mappingStore.set({ sourceId: nameSource.id, sourceHeader: nameHeader, shapeIri: `${EX}ArchitectShape`, propertyPath: `${EX}name` })
    const node = createHashNode(mappingStore)
    const handler = hashModule.connectionHandlers![0]
    handler.connect({ source: nameNode, sourceHandle: `h:${nameHeader}`, target: node.id, targetHandle: 'hash-input' }, context)
    handler.connect({ source: node.id, sourceHandle: 'h:hash', target: `shape:${EX}BuildingShape`, targetHandle: `p:${EX}architect` }, context)
    const output = dataStore.findById(`hash-output:${node.id}`)!
    const architectShape = ap.findNodeShape(`${EX}ArchitectShape`)!
    const effective = inheritReferenceIdentifiers(ap.allNodeShapes(), mappingStore.state, dataStore.sources)
    expect(effective.subjectIdentifier(architectShape.nodeId.value, output.id)).toBe('hash')
    const rdf = generateRdf(ap, mappingStore.state, dataStore.sources).store
    const architect = (name: string) => `${EX}Architect/${digest(name)}`
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Building`)).map(term => term.value).sort()).toEqual(['B1', 'B2', 'B3'].map(id => `${EX}Building/${id}`))
    const expectedNames = mode === 'array' ? ['XY Architects', 'Other Architects'] : ['XY Architects']
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Architect`)).map(term => term.value).sort()).toEqual(expectedNames.map(architect).sort())
    for (const name of expectedNames) {
      expect(rdf.each(namedNode(architect(name)), namedNode(`${EX}name`)).map(term => term.value)).toEqual([name])
      expect(rdf.holds(namedNode(`${EX}Building/B1`), namedNode(`${EX}architect`), namedNode(architect(name)))).toBe(true)
    }
    expect(rdf.each(namedNode(`${EX}Building/B2`), namedNode(`${EX}architect`)).map(term => term.value)).toEqual([architect('XY Architects')])
    expect(rdf.each(namedNode(`${EX}Building/B3`), namedNode(`${EX}architect`))).toEqual([])

    const zip = await JSZip.loadAsync(await (await buildRoCratePackage({ projectTitle: 'Hashed architects', ap, profiles: [profile], sources: dataStore.sources, mapping: mappingStore.state })).blob.arrayBuffer())
    const rml = buildRmlStore(ap, mappingStore.state, dataStore.sources)
    for (const [shape, input] of [[architectShape, nameSource], [ap.findNodeShape(`${EX}BuildingShape`)!, output]] as const) {
      const prepared = prepareEntityExport(shape, input, ap, mappingStore.state, dataStore.sources)!
      const path = sourcePathForExport(prepared.source)
      expect(rml.statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#source')).map(statement => statement.object.value)).toContain(path)
      const rows = Papa.parse<Record<string, string>>(await zip.file(path)!.async('string'), { header: true, skipEmptyLines: true }).data
      for (const row of rows) {
        const subject = namedNode(row[prepared.subjectHeader])
        expect(rdf.holds(subject, TYPE, shape.targetClass!)).toBe(true)
        if (shape === architectShape) expect(rdf.any(subject, namedNode(`${EX}name`))?.value).toBe(row[nameHeader])
        for (const [property, header] of prepared.referenceHeaders) {
          if (row[header]) expect(rdf.holds(subject, namedNode(property), namedNode(row[header]))).toBe(true)
        }
      }
    }
    expect(source.rows[0][2]).toBe(mode === 'array' ? 'XY Architects|Other Architects|XY Architects' : 'XY Architects')
  })
})
