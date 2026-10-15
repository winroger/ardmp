import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { namedNode } from 'rdflib'
import { parseShaclProfile } from '@/domain/NodeShape'
import { useShapesStore } from '@/stores/shapesStore'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { addGeoNamesNode } from '@/test/mappingExtensionFixtures'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'
import { getGeoNamesNode, runGeoNamesNode, updateGeoNamesNode } from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import * as client from '@/features/mapping/extensions/modules/nodes/geonames/client'
import ShapeNode from '@/features/mapping/components/canvas/ShapeNode.vue'
import { generateRdf } from '@/services/rdf/rdfGenerator'
import { prepareEntityExport } from '@/services/mapping/entityExport'
import { inheritReferenceIdentifiers } from '@/services/mapping/referenceIdentifiers'

const EX = 'http://example.org/'
const TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const PROFILE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <http://example.org/> .
ex:BuildingShape a sh:NodeShape ; sh:targetClass ex:Building ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] ;
 sh:property [ sh:path ex:location ; sh:node ex:LocationShape ] ;
 sh:property [ sh:path ex:relatedBuilding ; sh:node ex:BuildingShape ] ;
 sh:property [ sh:path ex:code ; sh:datatype xsd:string ] .
ex:LocationShape a sh:NodeShape ; sh:targetClass ex:Location ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] .
`

describe('GeoNames reference identity selection', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const ap = useShapesStore().ap
    ap.upsert(parseShaclProfile(PROFILE, 'entities.ttl', 'uploaded'))
    const dataStore = useDataStore()
    const mappingStore = useMappingStore()
    const source = csvSource('input', 'Buildings', ['row', 'building_id', 'place', 'geonames_id'], [
      ['r1', 'B1', 'Berlin', '2950159'], ['r2', 'B2', 'Berlin', '2950159'], ['r3', 'B3', 'Unknown', ''],
    ])
    dataStore.upsertSource(source)
    mappingStore.set({ sourceId: source.id, sourceHeader: 'building_id', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}name` })
    mappingStore.set({ sourceId: source.id, sourceHeader: 'place', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}name` })
    mappingStore.state.setSubjectIdentifier(`${EX}BuildingShape`, source.id, 'building_id')
    const node = addGeoNamesNode(mappingStore)
    updateGeoNamesNode(mappingStore, dataStore, node.id, { inputMode: 'text' })
    const context = { mappingStore, dataStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    const handler = geoNamesModule.connectionHandlers![0]
    handler.connect({ source: `src:${source.id}`, sourceHandle: 'h:place', target: node.id, targetHandle: 'geo-text-input' }, context)
    vi.spyOn(client, 'fetchGeoNameFeatures').mockResolvedValue({
      results: { Berlin: client.normalizeGeoNameFeature({ geonameId: 2950159, name: 'Berlin' }) },
      lookupErrors: [{ input: 'Unknown', message: 'No match' }],
      totalCount: 2, processedCount: 2, cachedCount: 0,
    })
    const connect = (header = 'id', property = 'location') => handler.connect({
      source: node.id, sourceHandle: `h:${header}`, target: `shape:${EX}BuildingShape`, targetHandle: `p:${EX}${property}`,
    }, context)
    const run = () => runGeoNamesNode(mappingStore, dataStore, node.id, dataStore.sources)
    const output = () => dataStore.findById(getGeoNamesNode(mappingStore, node.id)!.outputSourceId!)!
    const effective = () => inheritReferenceIdentifiers(ap.allNodeShapes(), mappingStore.state, dataStore.sources)
    const locationNode = () => mount(ShapeNode, {
      props: { data: { shape: ap.findNodeShape(`${EX}LocationShape`)! } }, global: { stubs: { Handle: true } },
    })
    return { ap, dataStore, mappingStore, node, source, handler, context, connect, run, output, effective, locationNode }
  }

  it('selects the referenced Location identifier after the first run for a connection made beforehand', async () => {
    const { ap, dataStore, mappingStore, source, connect, run, output, effective, locationNode } = setup()
    expect(connect()).toBe(true)
    await run()
    expect(effective().subjectIdentifier(`${EX}LocationShape`, output().id)).toBe('id')
    expect(mappingStore.state.subjectIdentifier(`${EX}LocationShape`, output().id)).toBeUndefined()
    expect(mappingStore.state.subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
    expect(mappingStore.state.subjectIdentifier(`${EX}BuildingShape`, output().id)).toBeUndefined()
    const rdf = generateRdf(ap, mappingStore.state, dataStore.sources).store
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Building`)).map(term => term.value).sort()).toEqual(['B1', 'B2', 'B3'].map(id => `${EX}Building/${id}`))
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Location`)).map(term => term.value)).toEqual([`${EX}Location/2950159`])
    for (const id of ['B1', 'B2']) expect(rdf.any(namedNode(`${EX}Building/${id}`), namedNode(`${EX}location`))?.value).toBe(`${EX}Location/2950159`)
    expect(rdf.any(namedNode(`${EX}Building/B3`), namedNode(`${EX}location`))).toBeNull()
    const shape = ap.findNodeShape(`${EX}LocationShape`)!
    const wrapper = locationNode()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('.identifier-value').text()).toContain('id')
    expect(wrapper.text()).toContain('Inherited from BuildingShape → location')
    expect(wrapper.text()).toContain('1 row(s) have no valid identifier')
    const prepared = prepareEntityExport(shape, source, ap, mappingStore.state, dataStore.sources)!
    expect(prepared.source.rows.map(row => row[prepared.source.headers.indexOf(prepared.subjectHeader)])).toEqual([`${EX}Location/2950159`, `${EX}Location/2950159`])
    const snapshot = mappingStore.createSnapshot()
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(effective().subjectIdentifier(`${EX}LocationShape`, output().id)).toBe('id')
  })

  it('selects the ID immediately when connecting an already populated GeoNames output', async () => {
    const { mappingStore, source, connect, run, output, effective, locationNode } = setup()
    await run()
    mappingStore.state.setSubjectIdentifier(`${EX}LocationShape`, source.id, 'row')
    expect(connect()).toBe(true)
    expect(effective().subjectIdentifier(`${EX}LocationShape`, output().id)).toBe('id')
    expect(locationNode().find('select').exists()).toBe(false)
    expect(mappingStore.state.subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
  })

  it('uses the connected reference field even if a saved manual selection differs', async () => {
    const { mappingStore, source, connect, run, output, effective, locationNode } = setup()
    connect()
    await run()
    mappingStore.state.setSubjectIdentifier(`${EX}LocationShape`, source.id, 'row')
    await run()
    expect(effective().subjectIdentifier(`${EX}LocationShape`, output().id)).toBe('id')
    expect(locationNode().find('select').exists()).toBe(false)
  })

  it('keeps ordinary GeoNames output mappings from changing any subject identifier', async () => {
    const { mappingStore, connect, run } = setup()
    await run()
    const identifiers = mappingStore.createSnapshot().subjectIdentifiers
    connect('name', 'name')
    connect('id', 'code')
    expect(mappingStore.state.subjectIdentifiers).toEqual(identifiers)
  })

  it('inherits a CSV column mapped to sh:node directly, updates it, and restores the selector when disconnected', async () => {
    const { ap, dataStore, mappingStore, source, locationNode } = setup()
    const wrapper = locationNode()
    expect(wrapper.find('select').exists()).toBe(true)
    const reference = { sourceId: source.id, sourceHeader: 'geonames_id', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` }
    mappingStore.set(reference)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('.identifier-value').text()).toBe('geonames_id · Buildings')
    const rdf = generateRdf(ap, mappingStore.state, dataStore.sources).store
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Location`)).map(term => term.value)).toEqual([`${EX}Location/2950159`])
    expect(rdf.each(undefined, TYPE, namedNode(`${EX}Building`))).toHaveLength(3)
    mappingStore.set({ ...reference, sourceHeader: 'place' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.identifier-value').text()).toBe('place · Buildings')
    const changed = generateRdf(ap, mappingStore.state, dataStore.sources).store
    expect(changed.any(namedNode(`${EX}Location/Berlin`), namedNode(`${EX}name`))?.value).toBe('Berlin')
    mappingStore.unset(reference.shapeIri, reference.propertyPath)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('select').exists()).toBe(true)
    expect(wrapper.find('.identifier-value').exists()).toBe(false)
    expect(mappingStore.state.subjectIdentifiers).toEqual([{ shapeIri: `${EX}BuildingShape`, sourceId: source.id, header: 'building_id' }])
  })

  it('preserves a profile identity when a reference points back to the same profile', () => {
    const { mappingStore, source, effective } = setup()
    mappingStore.set({ sourceId: source.id, sourceHeader: 'row', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}relatedBuilding` })
    expect(effective().subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
  })
})
