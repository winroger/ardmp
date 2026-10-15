import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import TransformNode from '@/features/mapping/components/canvas/TransformNode.vue'
import JSZip from 'jszip'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { addGeoNamesNode } from '@/test/mappingExtensionFixtures'
import { mergeModule } from '@/features/mapping/extensions/modules/nodes/merge'
import {
  createMergeNode, deleteMergeNode, getMergeInputs, materializeMergeOutputSource,
  MERGE_NODE_STATE_KEY, mergeValues, removeMergeInputsFromNode,
} from '@/features/mapping/extensions/modules/nodes/merge/workflow'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'
import { runGeoNamesNode, updateGeoNamesNode } from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import * as geoNamesClient from '@/features/mapping/extensions/modules/nodes/geonames/client'
import { buildRoCratePackage } from '@/services/export/exportService'
import { buildExtensionCanvasNodes, resolveMappingEdgeCanvasSource, resolveMaterializedNodeOutputSource } from '@/features/mapping/mappingExtensionRegistry'

const SHAPE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <http://example.org/> .
ex:PlaceShape a sh:NodeShape ; sh:targetClass ex:Place ;
  sh:property [ sh:name "Location" ; sh:path ex:location ; sh:datatype xsd:string ] .
`

describe('merge node', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const mappingStore = useMappingStore()
    const dataStore = useDataStore()
    const source = csvSource('places', 'places.csv', ['city', 'country', 'region'], [
      [' Berlin ', 'Germany', 'Europe'], ['', 'Canada', null], ['Vancouver', '', 'North America'], ['', '', ''],
    ], ['row-1', 'row-2', 'row-3', 'row-4'])
    dataStore.upsertSource(source)
    const node = createMergeNode(mappingStore)
    const context = { mappingStore, dataStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    const handler = mergeModule.connectionHandlers![0]!
    const connectInput = (index: number, header: string, sourceId = source.id) => handler.connect({
      source: `src:${sourceId}`, sourceHandle: `h:${header}`, target: node.id, targetHandle: `merge-input-${index}`,
    }, context)
    const canvasContext = {
      ...context, visibleSources: [source], openSetupDialog: vi.fn(), openNodePreview: vi.fn(), deleteNode: vi.fn(),
      isRefreshingSourceGroup: () => false, refreshSourceGroup: vi.fn(async () => {}), setSourceGroupEdgeVisibility: vi.fn(), runNode: vi.fn(async () => {}),
    }
    return { ...context, node, context, handler, connectInput, canvasContext }
  }

  it('joins nonempty values with comma and space, including zero and false', () => {
    expect(mergeValues([' Berlin ', ' Germany ', null, '', '  ', undefined, 0, false])).toBe('Berlin, Germany, 0, false')
    expect(mergeValues([null, ''])).toBe('')
  })

  it('edits and saves a literal separator, including empty text, and joins Airtable array elements with it', async () => {
    const { node, connectInput, canvasContext, dataStore, mappingStore, context } = setup()
    connectInput(1, 'city')
    connectInput(2, 'country')
    const canvasNode = () => buildExtensionCanvasNodes(canvasContext).find(candidate => candidate.id === node.id)!
    const wrapper = mount(TransformNode, { props: { data: canvasNode().data }, global: { stubs: { Handle: true, Button: true } } })
    expect(wrapper.find('input').element.value).toBe(', ')
    await wrapper.find('input').setValue(' | ')
    expect(dataStore.findById(`merge-output:${node.id}`)!.rows[0]).toEqual(['Berlin | Germany'])
    const snapshot = mappingStore.createSnapshot()
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(materializeMergeOutputSource(node.id, context)).toBe(`merge-output:${node.id}`)
    expect(dataStore.findById(`merge-output:${node.id}`)!.rows[0]).toEqual(['Berlin | Germany'])
    await wrapper.setProps({ data: canvasNode().data })
    await wrapper.find('input').setValue('')
    expect(dataStore.findById(`merge-output:${node.id}`)!.rows[0]).toEqual(['BerlinGermany'])
    expect(mergeValues([['A,B', 'C'], '', 'D'], ' | ')).toBe('A,B | C | D')
    mappingStore.updateExtensionNode(MERGE_NODE_STATE_KEY, node.id, current => ({ id: current.id, inputCount: 2 }))
    expect(dataStore.findById(materializeMergeOutputSource(node.id, context)!)!.rows[0]).toEqual(['Berlin, Germany'])
  })

  it('starts with two inputs and materializes rows with their original record IDs', () => {
    const { node, connectInput, context, dataStore, canvasContext } = setup()
    const canvasNode = buildExtensionCanvasNodes(canvasContext).find(candidate => candidate.id === node.id)!
    expect(canvasNode.data.title).toBe('merge')
    expect(canvasNode.data.inputs).toHaveLength(2)
    connectInput(2, 'country')
    connectInput(1, 'city')

    const sourceId = resolveMaterializedNodeOutputSource(node.id, context)!
    expect(dataStore.findById(sourceId)).toMatchObject({
      headers: ['merged'], rows: [['Berlin, Germany'], ['Canada'], ['Vancouver'], ['']],
      recordIds: ['row-1', 'row-2', 'row-3', 'row-4'], hidden: true,
    })
  })

  it('retains a single literal space entered in the separator field through saving and materialization', async () => {
    const { node, connectInput, canvasContext, mappingStore, context, dataStore } = setup()
    connectInput(1, 'city')
    connectInput(2, 'country')
    const data = () => buildExtensionCanvasNodes(canvasContext).find(candidate => candidate.id === node.id)!.data
    const wrapper = mount(TransformNode, { props: { data: data() }, global: { stubs: { Handle: true, Button: true } } })
    await wrapper.find('input').setValue(' ')
    await wrapper.setProps({ data: data() })
    expect(wrapper.find('input').element.value).toBe(' ')
    expect(dataStore.findById(`merge-output:${node.id}`)!.rows[0]).toEqual(['Berlin Germany'])
    const snapshot = mappingStore.createSnapshot()
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(dataStore.findById(materializeMergeOutputSource(node.id, context)!)!.rows[0]).toEqual(['Berlin Germany'])
    const spaceButton = wrapper.findAll('button').find(button => button.text() === 'Space')!
    await spaceButton.trigger('click')
    expect(wrapper.find('.separator-description').text()).toBe('Single space')
    const newlineButton = wrapper.findAll('button').find(button => button.text() === 'Line break')!
    await newlineButton.trigger('click')
    await wrapper.setProps({ data: data() })
    expect(wrapper.find('input').element.value).toBe('\\n')
    expect(dataStore.findById(`merge-output:${node.id}`)!.rows[0]).toEqual(['Berlin\nGermany'])
  })

  it('adds a third input and uses port order even when connections are made out of order', () => {
    const { node, connectInput, context, dataStore, canvasContext, mappingStore } = setup()
    const canvasNode = buildExtensionCanvasNodes(canvasContext).find(candidate => candidate.id === node.id)!
    canvasNode.data.onAddInput()
    connectInput(3, 'region')
    connectInput(2, 'country')
    connectInput(1, 'city')
    expect(dataStore.findById(materializeMergeOutputSource(node.id, context)!)).toMatchObject({
      rows: [['Berlin, Germany, Europe'], ['Canada'], ['Vancouver, North America'], ['']],
    })
    connectInput(2, 'region')
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(3)
    expect(dataStore.findById(materializeMergeOutputSource(node.id, context)!)?.rows[0]).toEqual(['Berlin, Europe, Europe'])
  })

  it('rejects fields from another table and invalid input ports', () => {
    const { connectInput, node, mappingStore, context, handler } = setup()
    connectInput(1, 'city')
    expect(connectInput(2, 'city', 'other-table')).toBe(true)
    expect(context.toast.add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Merge inputs must come from the same source table or the same GeoNames node.' }))
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(1)
    expect(connectInput(3, 'country')).toBe(false)
    expect(handler.connect({ source: 'src:places', sourceHandle: 'h:city', target: node.id, targetHandle: 'merge-input-0' }, context)).toBe(false)
    expect(materializeMergeOutputSource(node.id, context)).toBeUndefined()
  })

  it('refreshes mapped output on input changes and clears it when fewer than two fields remain', () => {
    const { connectInput, node, context, handler, dataStore, mappingStore } = setup()
    connectInput(1, 'city')
    connectInput(2, 'country')
    handler.connect({ source: node.id, sourceHandle: 'h:merged', target: 'shape:http://example.org/PlaceShape', targetHandle: 'p:http://example.org/location' }, context)
    const edge = mappingStore.state.edges[0]!
    expect(resolveMappingEdgeCanvasSource(edge)).toEqual({ source: node.id, sourceHandle: 'h:merged' })
    connectInput(2, 'region')
    expect(dataStore.findById(edge.sourceId)?.rows[0]).toEqual(['Berlin, Europe'])
    handler.deleteUiEdge!(`merge-ui:${node.id}:merge-input-2`, context)
    expect(dataStore.findById(edge.sourceId)).toBeUndefined()
    expect(mappingStore.state.edges).toHaveLength(0)
    connectInput(2, 'country')
    expect(mappingStore.state.edges).toHaveLength(1)
  })

  it('preserves extra inputs and connections in project snapshots', () => {
    const { connectInput, node, context, mappingStore, dataStore, canvasContext } = setup()
    buildExtensionCanvasNodes(canvasContext).find(candidate => candidate.id === node.id)!.data.onAddInput()
    connectInput(1, 'city')
    connectInput(2, 'country')
    connectInput(3, 'region')
    const snapshot = mappingStore.createSnapshot()
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(mappingStore.findExtensionNode(MERGE_NODE_STATE_KEY, node.id)).toMatchObject({ inputCount: 3 })
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(3)
    expect(dataStore.findById(materializeMergeOutputSource(node.id, context)!)?.rows[0]).toEqual(['Berlin, Germany, Europe'])
  })

  it('feeds merged text into GeoNames and removes the downstream connection when deleted', async () => {
    const { node, connectInput, context, dataStore, mappingStore } = setup()
    connectInput(1, 'city')
    connectInput(2, 'country')
    const geoNode = addGeoNamesNode(mappingStore)
    updateGeoNamesNode(mappingStore, dataStore, geoNode.id, { inputMode: 'text' })
    const fetchMock = vi.spyOn(geoNamesClient, 'fetchGeoNameFeatures').mockImplementation(async values => ({
      results: Object.fromEntries(values.map(value => [value, geoNamesClient.normalizeGeoNameFeature({ geonameId: 1, name: value })])),
      totalCount: values.length, processedCount: values.length, cachedCount: 0,
      lookupErrors: [],
    }))
    expect(geoNamesModule.connectionHandlers![0]!.connect({ source: node.id, sourceHandle: 'h:merged', target: geoNode.id, targetHandle: 'geo-text-input' }, context)).toBe(true)
    await runGeoNamesNode(mappingStore, dataStore, geoNode.id, dataStore.sources.filter(source => source.id === 'places'))
    expect(fetchMock).toHaveBeenCalledWith(['Berlin, Germany', 'Canada', 'Vancouver'], 'demo-user', expect.objectContaining({ inputType: 'text' }))
    expect(dataStore.findById(`geonames-output:${geoNode.id}`)?.recordIds).toEqual(['row-1', 'row-2', 'row-3', 'row-4'])
    deleteMergeNode(node.id, context)
    expect(mappingStore.findExtensionNode(MERGE_NODE_STATE_KEY, node.id)).toBeUndefined()
    expect(materializeMergeOutputSource(node.id, context)).toBeUndefined()
    expect(mappingStore.getExtensionState('node.geonames.uiEdges', [])).toHaveLength(0)
  })

  it('exports merged values as RDF, RML references and a materialized CSV', async () => {
    const { node, connectInput, context, handler, dataStore, mappingStore } = setup()
    connectInput(1, 'city')
    connectInput(2, 'country')
    handler.connect({ source: node.id, sourceHandle: 'h:merged', target: 'shape:http://example.org/PlaceShape', targetHandle: 'p:http://example.org/location' }, context)
    const ap = new ApplicationProfile()
    const profile = parseShaclProfile(SHAPE, 'places.ttl', 'uploaded')
    ap.upsert(profile)
    const result = await buildRoCratePackage({ projectTitle: 'Merge export', ap, profiles: [profile], sources: dataStore.sources, mapping: mappingStore.state })
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const rdf = await zip.file('data/dataset.ttl')!.async('string')
    const rml = await zip.file('mapping/mapping.rml.ttl')!.async('string')
    const mergeCsvPath = Object.keys(zip.files).find(path => path.startsWith('sources/merge_') && path.endsWith('.csv'))!
    expect(rdf).toContain('"Berlin, Germany"')
    expect(rml).toContain('rml:reference "merged"')
    expect(await zip.file(mergeCsvPath)!.async('string')).toContain('"Berlin, Germany"')
  })

  it('merges GeoNames outputs after enrichment, preserves failed rows and refreshes mapped values', async () => {
    const { node, context, mappingStore, dataStore, handler } = setup()
    dataStore.upsertSource(csvSource('places', 'Places', ['city'], [['Berlin'], ['Unknown'], ['Vancouver'], ['Berlin']], ['row-1', 'row-2', 'row-3', 'row-4']))
    const geoNode = addGeoNamesNode(mappingStore)
    updateGeoNamesNode(mappingStore, dataStore, geoNode.id, { inputMode: 'text', selectedOutputs: ['name', 'countryName'] })
    geoNamesModule.connectionHandlers![0]!.connect({ source: 'src:places', sourceHandle: 'h:city', target: geoNode.id, targetHandle: 'geo-text-input' }, context)
    let suffix = ''
    vi.spyOn(geoNamesClient, 'fetchGeoNameFeatures').mockImplementation(async values => ({
      results: Object.fromEntries([...new Set(values)].filter(value => value !== 'Unknown').map(value => [value,
        geoNamesClient.normalizeGeoNameFeature({ geonameId: 1, name: `${value}${suffix}`, countryName: value === 'Berlin' ? 'Germany' : 'Canada' })])),
      totalCount: 3, processedCount: 3, cachedCount: 0, lookupErrors: [{ input: 'Unknown', message: 'No match' }],
    }))
    const connect = (header: string, index: number) => handler.connect({ source: geoNode.id, sourceHandle: `h:${header}`, target: node.id, targetHandle: `merge-input-${index}` }, context)

    expect(connect('name', 1)).toBe(true)
    expect(connect('countryName', 2)).toBe(true)
    expect(materializeMergeOutputSource(node.id, context)).toBeUndefined()
    handler.connect({ source: node.id, sourceHandle: 'h:merged', target: 'shape:Place', targetHandle: 'p:label' }, context)
    await runGeoNamesNode(mappingStore, dataStore, geoNode.id, context.sources)

    const outputId = `merge-output:${node.id}`
    expect(dataStore.findById(outputId)).toMatchObject({
      rows: [['Berlin, Germany'], [''], ['Vancouver, Canada'], ['Berlin, Germany']],
      recordIds: ['row-1', 'row-2', 'row-3', 'row-4'],
    })
    expect(mappingStore.state.edges).toContainEqual(expect.objectContaining({ sourceId: outputId, sourceHeader: 'merged' }))
    suffix = ' updated'
    await runGeoNamesNode(mappingStore, dataStore, geoNode.id, context.sources, true)
    expect(dataStore.findById(outputId)?.rows[0]).toEqual(['Berlin updated, Germany'])

    const snapshot = mappingStore.createSnapshot()
    const sources = dataStore.createSnapshot()
    mappingStore.reset()
    dataStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    dataStore.restoreSnapshot(sources)
    expect(dataStore.findById(materializeMergeOutputSource(node.id, context)!)?.rows[2]).toEqual(['Vancouver updated, Canada'])
    updateGeoNamesNode(mappingStore, dataStore, geoNode.id, { selectedOutputs: ['name'] })
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(1)
    expect(dataStore.findById(outputId)).toBeUndefined()
    expect(mappingStore.state.edges).toHaveLength(0)
  })

  it('clears dependent merge output on GeoNames mode changes and removes connections on deletion', async () => {
    const { node, context, mappingStore, dataStore, handler } = setup()
    const geoNode = addGeoNamesNode(mappingStore)
    updateGeoNamesNode(mappingStore, dataStore, geoNode.id, { inputMode: 'text', selectedOutputs: ['name', 'countryName'] })
    geoNamesModule.connectionHandlers![0]!.connect({ source: 'src:places', sourceHandle: 'h:city', target: geoNode.id, targetHandle: 'geo-text-input' }, context)
    vi.spyOn(geoNamesClient, 'fetchGeoNameFeatures').mockImplementation(async values => ({
      results: Object.fromEntries(values.map(value => [value, geoNamesClient.normalizeGeoNameFeature({ geonameId: 1, name: value, countryName: 'Country' })])),
      totalCount: values.length, processedCount: values.length, cachedCount: 0, lookupErrors: [],
    }))
    await runGeoNamesNode(mappingStore, dataStore, geoNode.id, context.sources)
    for (const [index, header] of ['name', 'countryName'].entries()) {
      handler.connect({ source: geoNode.id, sourceHandle: `h:${header}`, target: node.id, targetHandle: `merge-input-${index + 1}` }, context)
    }
    const outputId = `merge-output:${node.id}`
    expect(dataStore.findById(outputId)).toBeTruthy()
    updateGeoNamesNode(mappingStore, dataStore, geoNode.id, { inputMode: 'id' })
    expect(dataStore.findById(outputId)).toBeUndefined()
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(2)
    mappingStore.removeExtensionNode('node.geonames.nodes', geoNode.id)
    removeMergeInputsFromNode(geoNode.id, context)
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(0)
  })

  it('rejects cycles in either direction between GeoNames and merge', () => {
    const { node, context, mappingStore, dataStore, handler } = setup()
    const geoNode = addGeoNamesNode(mappingStore)
    updateGeoNamesNode(mappingStore, dataStore, geoNode.id, { inputMode: 'text' })
    const geoHandler = geoNamesModule.connectionHandlers![0]!
    geoHandler.connect({ source: node.id, sourceHandle: 'h:merged', target: geoNode.id, targetHandle: 'geo-text-input' }, context)
    expect(handler.connect({ source: geoNode.id, sourceHandle: 'h:name', target: node.id, targetHandle: 'merge-input-1' }, context)).toBe(true)
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(0)
    expect(context.toast.add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Connection would create a cycle' }))

    mappingStore.setExtensionState('node.geonames.uiEdges', [])
    handler.connect({ source: geoNode.id, sourceHandle: 'h:name', target: node.id, targetHandle: 'merge-input-1' }, context)
    geoHandler.connect({ source: node.id, sourceHandle: 'h:merged', target: geoNode.id, targetHandle: 'geo-text-input' }, context)
    expect(mappingStore.getExtensionState('node.geonames.uiEdges', [])).toHaveLength(0)
    expect(getMergeInputs(mappingStore, node.id)).toHaveLength(1)
  })
})
