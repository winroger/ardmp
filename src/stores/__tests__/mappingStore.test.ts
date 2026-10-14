import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getGeoNamesNode, runGeoNamesNode } from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import { fetchGeoNameFeatures } from '@/features/mapping/extensions/modules/nodes/geonames/client'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'
import { useMappingStore } from '@/stores/mappingStore'
import { useDataStore } from '@/stores/dataStore'
import type { DataSource } from '@/domain/DataSource'
import { csvSource } from '@/test/dataSources'
import {
  addGeoNamesNode,
  geoNamesNodes,
  geoNamesUiEdges,
  upsertGeoNamesUiEdge,
} from '@/test/mappingExtensionFixtures'

vi.mock('@/features/mapping/extensions/modules/nodes/geonames/client', () => ({
  fetchGeoNameFeature: vi.fn(async (id: string) => ({
    feature: {
      id,
      name: 'Test',
      toponymName: 'Test',
      lat: '1',
      lng: '2',
      countryCode: 'CA',
      countryName: 'Canada',
      continentCode: 'NA',
      adminName1: '',
      adminName2: '',
      adminName3: '',
      adminCode1: '',
      adminCode2: '',
      adminCode3: '',
      featureClass: 'P',
      featureCode: 'PPL',
      fcodeName: 'populated place',
      population: '1000',
      elevation: '',
      dem: '',
      timezoneId: '',
      wikipediaURL: '',
    },
    fromCache: false,
  })),
  fetchGeoNameFeatures: vi.fn(async (ids: string[]) => ({
    results: Object.fromEntries(ids.map(id => [id, {
      id,
      name: `Geo ${id}`,
      toponymName: `Geo ${id}`,
      lat: '1',
      lng: '2',
      countryCode: 'CA',
      countryName: 'Canada',
      continentCode: 'NA',
      adminName1: '',
      adminName2: '',
      adminName3: '',
      adminCode1: '',
      adminCode2: '',
      adminCode3: '',
      featureClass: 'P',
      featureCode: 'PPL',
      fcodeName: 'populated place',
      population: '1000',
      elevation: '',
      dem: '',
      timezoneId: '',
      wikipediaURL: '',
    }])) ,
    totalCount: ids.length,
    lookupErrors: [],
    processedCount: ids.length,
    cachedCount: 0,
  })),
}))

describe('mappingStore GeoNames flow state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')
  })

  it('adds a GeoNames node with a stable generated id', () => {
    const store = useMappingStore()

    const node = addGeoNamesNode(store, 'demo-user')

    expect(node).toEqual({
      id: 'geonames:11111111-1111-4111-8111-111111111111',
      username: 'demo-user',
      selectedOutputs: ['name', 'id', 'lat', 'lng'],
      status: 'idle',
      stats: { totalCount: 0, processedCount: 0, cachedCount: 0 },
      results: {},
    })
    expect(geoNamesNodes(store)).toEqual([node])
  })

  it('replaces an existing UI edge for the same target handle', () => {
    const store = useMappingStore()

    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:a',
      source: 'src:table-a',
      sourceHandle: 'h:id',
      target: 'geonames:node-a',
      targetHandle: 'geo-input',
    })

    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:b',
      source: 'src:table-b',
      sourceHandle: 'h:otherId',
      target: 'geonames:node-a',
      targetHandle: 'geo-input',
    })

    expect(geoNamesUiEdges(store)).toEqual([
      {
        id: 'geo-ui:b',
        source: 'src:table-b',
        sourceHandle: 'h:otherId',
        target: 'geonames:node-a',
        targetHandle: 'geo-input',
      },
    ])
  })

  it('runs a GeoNames node against the connected source column', async () => {
    const store = useMappingStore()
    const dataStore = useDataStore()
    const node = addGeoNamesNode(store, 'demo-user')
    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:input',
      source: 'src:cities',
      sourceHandle: 'h:geoId',
      target: node.id,
      targetHandle: 'geo-input',
    })

    const sources = [
      csvSource('cities', 'Cities', ['geoId'], [['6173331'], ['5128581']]),
    ] satisfies DataSource[]

    await runGeoNamesNode(store, dataStore, node.id, sources)

    expect(getGeoNamesNode(store, node.id)?.status).toBe('success')
    expect(getGeoNamesNode(store, node.id)?.outputSourceId).toBe(`geonames-output:${node.id}`)
    expect(getGeoNamesNode(store, node.id)?.stats.processedCount).toBe(2)
    expect(getGeoNamesNode(store, node.id)?.results['6173331']?.name).toBe('Geo 6173331')
    expect(dataStore.findById(`geonames-output:${node.id}`)?.hidden).toBe(true)
    expect(dataStore.findById(`geonames-output:${node.id}`)?.headers).toEqual(['name', 'id', 'lat', 'lng'])
  })

  it('runs the free text input and restores its results from a project snapshot', async () => {
    const store = useMappingStore()
    const dataStore = useDataStore()
    const node = addGeoNamesNode(store, 'demo-user')
    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:text-input',
      source: 'src:places',
      sourceHandle: 'h:place',
      target: node.id,
      targetHandle: 'geo-text-input',
    })
    const sample = await fetchGeoNameFeatures(['6173331'], 'demo-user')
    vi.mocked(fetchGeoNameFeatures).mockResolvedValueOnce({ ...sample, results: { Vancouver: sample.results['6173331']! } })
    const source = { ...csvSource('places', 'Places', ['place'], [['Vancouver'], [''], ['Vancouver']]),
      recordIds: ['row-a', 'row-b', 'row-c'] }

    await runGeoNamesNode(store, dataStore, node.id, [source])

    expect(fetchGeoNameFeatures).toHaveBeenLastCalledWith(['Vancouver', 'Vancouver'], 'demo-user', expect.objectContaining({ inputType: 'text' }))
    expect(getGeoNamesNode(store, node.id)).toMatchObject({ inputType: 'text', status: 'success', results: { Vancouver: { id: '6173331' } } })
    expect(dataStore.findById(`geonames-output:${node.id}`)).toMatchObject({
      rows: [['Geo 6173331', '6173331', '1', '2'], ['', '', '', ''], ['Geo 6173331', '6173331', '1', '2']],
      recordIds: source.recordIds,
    })
    const snapshot = store.createSnapshot()
    store.reset()
    store.restoreSnapshot(snapshot)
    expect(getGeoNamesNode(store, node.id)).toMatchObject({ inputType: 'text', results: { Vancouver: { id: '6173331' } } })
    expect(geoNamesUiEdges(store)[0]?.targetHandle).toBe('geo-text-input')
  })

  it('completes with warnings, persists lookup errors and clears them after a successful retry', async () => {
    const store = useMappingStore()
    const dataStore = useDataStore()
    const node = addGeoNamesNode(store)
    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:input', source: 'src:places', sourceHandle: 'h:id', target: node.id, targetHandle: 'geo-input',
    })
    const sample = await fetchGeoNameFeatures(['good'], 'demo')
    const lookupErrors = [{ input: 'missing', message: 'Unknown location' }]
    vi.mocked(fetchGeoNameFeatures).mockImplementationOnce(async (_values, _username, options) => {
      options?.onProgress?.({ processedCount: 2, totalCount: 2, cachedCount: 0, currentId: 'missing', lookupErrors })
      expect(getGeoNamesNode(store, node.id)).toMatchObject({ status: 'running', lookupErrors })
      return { ...sample, totalCount: 2, processedCount: 2, lookupErrors }
    })
    const context = { mappingStore: store, dataStore, sources: [csvSource('places', 'Places', ['id'], [['good'], ['missing']])] }

    const completion = await geoNamesModule.runtimeHandlers![0]!.run(node.id, context)

    expect(completion).toMatchObject({ successSeverity: 'warn', successSummary: 'GeoNames completed with warnings' })
    expect(completion.successDetail).toContain('1 lookup(s) failed')
    expect(getGeoNamesNode(store, node.id)).toMatchObject({ status: 'success', lookupErrors })
    expect(getGeoNamesNode(store, node.id)?.stats.lastError).toBeUndefined()
    expect(dataStore.findById(`geonames-output:${node.id}`)?.rows).toEqual([['Geo good', 'good', '1', '2'], ['', '', '', '']])

    const snapshot = store.createSnapshot()
    const storedErrors = getGeoNamesNode(store, node.id)!.lookupErrors!
    const savedNode = (snapshot.extensionState['node.geonames'] as { nodes: typeof node[] }).nodes[0]!
    expect(savedNode.lookupErrors).not.toBe(storedErrors)
    expect(savedNode.lookupErrors?.[0]).not.toBe(storedErrors[0])
    storedErrors[0]!.message = 'Changed after saving'
    store.reset()
    expect(getGeoNamesNode(store, node.id)).toBeUndefined()
    store.restoreSnapshot(snapshot)
    expect(getGeoNamesNode(store, node.id)?.lookupErrors).toEqual([{ input: 'missing', message: 'Unknown location' }])
    const retry = await geoNamesModule.runtimeHandlers![0]!.run(node.id, context)
    expect(retry.successSeverity).toBe('success')
    expect(getGeoNamesNode(store, node.id)?.lookupErrors).toEqual([])
    expect(dataStore.findById(`geonames-output:${node.id}`)?.rows[1]).toEqual(['Geo missing', 'missing', '1', '2'])
  })

  it('syncs direct GeoNames output mappings to shapes after the GeoNames node runs', async () => {
    const store = useMappingStore()
    const node = addGeoNamesNode(store, 'demo-user')

    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:input',
      source: 'src:cities',
      sourceHandle: 'h:geoId',
      target: node.id,
      targetHandle: 'geo-input',
    })
    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:shape-id',
      source: node.id,
      sourceHandle: 'h:id',
      target: 'shape:http://example.org/LocationShape',
      targetHandle: 'p:http://example.org/geonamesId',
    })
    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:shape-name',
      source: node.id,
      sourceHandle: 'h:name',
      target: 'shape:http://example.org/LocationShape',
      targetHandle: 'p:http://www.w3.org/2000/01/rdf-schema#label',
    })

    const sources = [
      csvSource('cities', 'Cities', ['geoId'], [['6173331'], ['5128581']]),
    ] satisfies DataSource[]

    await runGeoNamesNode(store, useDataStore(), node.id, sources)

    expect(store.state.forProperty('http://example.org/LocationShape', 'http://example.org/geonamesId')).toMatchObject({
      sourceId: `geonames-output:${node.id}`,
      sourceHeader: 'id',
      source: { kind: 'node-output', provider: 'geonames', nodeId: node.id },
    })
    expect(store.state.forProperty('http://example.org/LocationShape', 'http://www.w3.org/2000/01/rdf-schema#label')).toMatchObject({
      sourceId: `geonames-output:${node.id}`,
      sourceHeader: 'name',
      source: { kind: 'node-output', provider: 'geonames', nodeId: node.id },
    })
  })

  it('syncs WKT transform mappings from connected lat/lng inputs', () => {
    const store = useMappingStore()
    const transformNode = store.addTransformationNode()

    store.upsertTransformationUiEdge({
      id: `transform-ui:${transformNode.id}:lat-input`,
      source: 'src:places',
      sourceHandle: 'h:lat',
      target: transformNode.id,
      targetHandle: 'lat-input',
    })
    store.upsertTransformationUiEdge({
      id: `transform-ui:${transformNode.id}:lng-input`,
      source: 'src:places',
      sourceHandle: 'h:lng',
      target: transformNode.id,
      targetHandle: 'lng-input',
    })

    store.set({
      sourceId: 'places',
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://www.opengis.net/ont/geosparql#asWKT',
      transform: 'lat-lng-to-wkt',
      transformNodeId: transformNode.id,
    })
    store.upsertTransformationUiEdge({
      id: `transform-ui:${transformNode.id}:lat-input`,
      source: 'src:places',
      sourceHandle: 'h:lat',
      target: transformNode.id,
      targetHandle: 'lat-input',
    })

    expect(store.state.edges[0]).toMatchObject({
      sourceId: 'places',
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      transform: 'lat-lng-to-wkt',
      transformNodeId: transformNode.id,
    })
  })

  it('syncs WKT transform mappings from GeoNames lat/lng outputs after the GeoNames node runs', async () => {
    const store = useMappingStore()
    const node = addGeoNamesNode(store, 'demo-user')
    const transformNode = store.addTransformationNode()

    upsertGeoNamesUiEdge(store, {
      id: 'geo-ui:input',
      source: 'src:cities',
      sourceHandle: 'h:geoId',
      target: node.id,
      targetHandle: 'geo-input',
    })
    store.upsertTransformationUiEdge({
      id: `transform-ui:${transformNode.id}:lat-input`,
      source: node.id,
      sourceHandle: 'h:lat',
      target: transformNode.id,
      targetHandle: 'lat-input',
    })
    store.upsertTransformationUiEdge({
      id: `transform-ui:${transformNode.id}:lng-input`,
      source: node.id,
      sourceHandle: 'h:lng',
      target: transformNode.id,
      targetHandle: 'lng-input',
    })
    store.set({
      sourceId: '',
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      shapeIri: 'http://example.org/PlaceShape',
      propertyPath: 'http://www.opengis.net/ont/geosparql#asWKT',
      transform: 'lat-lng-to-wkt',
      transformNodeId: transformNode.id,
    })

    const sources = [
      csvSource('cities', 'Cities', ['geoId'], [['6173331'], ['5128581']]),
    ] satisfies DataSource[]

    await runGeoNamesNode(store, useDataStore(), node.id, sources)

    expect(store.state.edges[0]).toMatchObject({
      sourceId: `geonames-output:${node.id}`,
      sourceHeader: 'lat',
      secondarySourceHeader: 'lng',
      transform: 'lat-lng-to-wkt',
      transformNodeId: transformNode.id,
    })
  })
})


