import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { namedNode } from 'rdflib'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { parseShaclProfile } from '@/domain/NodeShape'
import { useShapesStore } from '@/stores/shapesStore'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import ShapeNode from '@/features/mapping/components/canvas/ShapeNode.vue'
import { importCsvFiles } from '@/features/mapping/extensions/modules/source-data/csv-file/workflow'
import { createSplitNode, updateSplitNode } from '@/features/mapping/extensions/modules/nodes/split/workflow'
import { splitModule } from '@/features/mapping/extensions/modules/nodes/split'
import { generateRdf } from '@/services/rdf/rdfGenerator'
import { prepareEntityExport } from '@/services/mapping/entityExport'
import { inheritReferenceIdentifiers } from '@/services/mapping/referenceIdentifiers'
import { createReferenceResolver } from '@/services/mapping/entityIdentity'
import { sourcePathForExport } from '@/services/mapping/mappingSemantics'
import { stagingPropertyForColumn } from '@/services/mapping/stagingSemantics'
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
 sh:property [ sh:path ex:source ; sh:node ex:SourceShape ] .
ex:SourceShape a sh:NodeShape ; sh:targetClass ex:Source ;
 sh:property [ sh:path ex:url ; sh:nodeKind sh:IRI ] ;
 sh:property [ sh:path ex:title ; sh:datatype xsd:string ] .
`

function setup() {
  const ap = useShapesStore().ap
  const profile = parseShaclProfile(PROFILE, 'sources.ttl', 'uploaded')
  ap.upsert(profile)
  return { ap, profile, dataStore: useDataStore(), mappingStore: useMappingStore() }
}

describe('array entity identifiers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('links split multiline CSV URLs to individual Source entities while preserving Building identities in the UI, RDF and RML archive', async () => {
    const { ap, profile, dataStore, mappingStore } = setup()
    const urls = ['https://www.nextroom.at/building.php?id=28438', 'https://2015.wienwood.at/05/projekte/wohnbau-spoettelgasse.htm']
    await importCsvFiles(dataStore, [new File([
      `_recordId,id,name,urls\nr1,B1,Museum,"${urls[0]}\n${urls[1]}\n${urls[1]}"\nr2,B2,Library,${urls[1]}\nr3,B3,Empty,\n`,
    ], 'buildings.csv', { type: 'text/csv' })])
    const source = dataStore.sources[0]
    mappingStore.set({ sourceId: source.id, sourceHeader: 'name', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}name` })
    mappingStore.state.setSubjectIdentifier(`${EX}BuildingShape`, source.id, 'id')
    const node = createSplitNode(mappingStore)
    const context = { dataStore, mappingStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    updateSplitNode(node.id, { mode: 'array', separator: '\n' }, context)
    const handler = splitModule.connectionHandlers![0]
    handler.connect({ source: `src:${source.id}`, sourceHandle: 'h:urls', target: node.id, targetHandle: 'split-input' }, context)
    for (const [shape, property] of [['Building', 'source'], ['Source', 'url']]) {
      handler.connect({ source: node.id, sourceHandle: 'h:values', target: `shape:${EX}${shape}Shape`, targetHandle: `p:${EX}${property}` }, context)
    }
    const output = dataStore.findById(`split-output:${node.id}`)!
    const target = ap.findNodeShape(`${EX}SourceShape`)!
    const inherited = inheritReferenceIdentifiers(ap.allNodeShapes(), mappingStore.state, dataStore.sources)
    expect(inherited.subjectIdentifier(target.nodeId.value, output.id)).toBe('values')
    const wrapper = mount(ShapeNode, { props: { data: { shape: target } }, global: { stubs: { Handle: true } } })
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('.identifier-value').text()).toContain('values')
    expect(wrapper.text()).toContain('1 row(s) have no valid identifier')
    wrapper.unmount()

    const rdf = generateRdf(ap, mappingStore.state, dataStore.sources).store
    const subjects = urls.map(url => `${EX}Source/${encodeURIComponent(url)}`)
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Building`)).map(term => term.value).sort()).toEqual(['B1', 'B2', 'B3'].map(id => `${EX}Building/${id}`))
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Source`)).map(term => term.value).sort()).toEqual([...subjects].sort())
    expect(rdf.each(namedNode(`${EX}Building/B1`), namedNode(`${EX}source`)).map(term => term.value).sort()).toEqual([...subjects].sort())
    expect(rdf.each(namedNode(`${EX}Building/B2`), namedNode(`${EX}source`)).map(term => term.value)).toEqual([subjects[1]])
    expect(rdf.each(namedNode(`${EX}Building/B3`), namedNode(`${EX}source`))).toEqual([])
    for (const [index, subject] of subjects.entries()) {
      expect(rdf.each(namedNode(subject), namedNode(`${EX}url`)).map(term => term.value)).toEqual([urls[index]])
    }

    const prepared = prepareEntityExport(target, output, ap, mappingStore.state, dataStore.sources)!
    const zip = await JSZip.loadAsync(await (await buildRoCratePackage({ projectTitle: 'Sources', ap, profiles: [profile], sources: dataStore.sources, mapping: mappingStore.state })).blob.arrayBuffer())
    const path = sourcePathForExport(prepared.source)
    const rows = Papa.parse<Record<string, string>>(await zip.file(path)!.async('string'), { header: true, skipEmptyLines: true }).data
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(rdf.holds(namedNode(row[prepared.subjectHeader]), namedNode(`${EX}url`), namedNode(row.values))).toBe(true)
    expect(rows.map(row => row._recordId)).toEqual(['r1', 'r1', 'r1', 'r2'])
    const rml = buildRmlStore(ap, mappingStore.state, dataStore.sources)
    expect(rml.statementsMatching(undefined, namedNode('http://semweb.mmlab.be/ns/rml#source')).map(statement => statement.object.value)).toContain(path)
    const buildingExport = prepareEntityExport(ap.findNodeShape(`${EX}BuildingShape`)!, output, ap, mappingStore.state, dataStore.sources)!
    const reference = buildingExport.referenceHeaders.get(`${EX}source`)!
    for (const row of buildingExport.source.rows) {
      const get = (header: string) => String(row[buildingExport.source.headers.indexOf(header)])
      if (get(reference)) expect(rdf.holds(namedNode(get(buildingExport.subjectHeader)), namedNode(`${EX}source`), namedNode(get(reference)))).toBe(true)
    }
    expect(output.rows[0][0]).toEqual([urls[0], urls[1], urls[1]])
    expect(source.rows).toHaveLength(3)
  })

  it('aligns array properties by position, skips invalid IDs and applies scalar properties to each entity for automatic same-row links', () => {
    const { ap, dataStore, mappingStore } = setup()
    const source = csvSource('input', 'Buildings', ['id', 'name', 'sourceIds', 'titles', 'note'], [
      ['B1', 'Museum', ['S1', '', null, {}, ['nested'], 'S2'], ['One', 'skip', 'skip', 'skip', 'skip', 'Two'], 'shared'],
      ['B2', 'Empty', [], [], 'skip'],
    ], ['r1', 'r2'])
    dataStore.upsertSource(source)
    mappingStore.set({ sourceId: source.id, sourceHeader: 'name', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}name` })
    mappingStore.set({ sourceId: source.id, sourceHeader: 'titles', shapeIri: `${EX}SourceShape`, propertyPath: `${EX}title` })
    mappingStore.state.setSubjectIdentifier(`${EX}SourceShape`, source.id, 'sourceIds')
    const rdf = generateRdf(ap, mappingStore.state, [source]).store
    for (const [id, title] of [['S1', 'One'], ['S2', 'Two']]) {
      expect(rdf.each(namedNode(`${EX}Source/${id}`), namedNode(`${EX}title`)).map(term => term.value)).toEqual([title])
    }
    expect(rdf.each(namedNode(`${EX}Building/r1`), namedNode(`${EX}source`)).map(term => term.value)).toEqual([`${EX}Source/S1`, `${EX}Source/S2`])
    expect(rdf.each(namedNode(`${EX}Building/r2`), namedNode(`${EX}source`))).toEqual([])
    const prepared = prepareEntityExport(ap.findNodeShape(`${EX}BuildingShape`)!, source, ap, mappingStore.state, [source])!
    const ref = prepared.referenceHeaders.get(`${EX}source`)!
    expect(new Set(prepared.source.rows.map(row => row[prepared.source.headers.indexOf(ref)]))).toEqual(new Set([`${EX}Source/S1`, `${EX}Source/S2`, '']))
    // A single-profile table attaches unmapped scalar columns to every expanded entity.
    mappingStore.unset(`${EX}BuildingShape`, `${EX}name`)
    const hybrid = generateRdf(ap, mappingStore.state, [source]).store
    for (const id of ['S1', 'S2']) expect(hybrid.any(namedNode(`${EX}Source/${id}`), stagingPropertyForColumn(source, 'note'))?.value).toBe('shared')
  })

  it('resolves a scalar foreign key to only its array entity, and a storage record key to every entity in that record', () => {
    const { ap, dataStore, mappingStore } = setup()
    const source = csvSource('sources', 'Sources', ['ids', 'titles'], [[['S1', 'S2'], ['One', 'Two']], [[], []]], ['r1', 'r2'])
    dataStore.upsertSource(source)
    mappingStore.set({ sourceId: source.id, sourceHeader: 'titles', shapeIri: `${EX}SourceShape`, propertyPath: `${EX}title` })
    mappingStore.state.setSubjectIdentifier(`${EX}SourceShape`, source.id, 'ids')
    const resolve = createReferenceResolver(mappingStore.state, [source])
    const target = ap.findNodeShape(`${EX}SourceShape`)!
    expect(resolve(target, 'S1').map(term => term.value)).toEqual([`${EX}Source/S1`])
    expect(resolve(target, 'S2').map(term => term.value)).toEqual([`${EX}Source/S2`])
    expect(resolve(target, 'r1').map(term => term.value)).toEqual([`${EX}Source/S1`, `${EX}Source/S2`])
    expect(resolve(target, 'r2')).toEqual([])
  })
})
