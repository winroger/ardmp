import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import InputText from 'primevue/inputtext'
import Listbox from 'primevue/listbox'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { addGeoNamesNode } from '@/test/mappingExtensionFixtures'
import { buildExtensionCanvasNodes } from '@/features/mapping/mappingExtensionRegistry'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'
import {
  getGeoNamesInputEdges, getGeoNamesInputMode, getGeoNamesNode, getGeoNamesUiEdges,
  materializeGeoNamesOutputSource, runGeoNamesNode, updateGeoNamesNode,
} from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import * as client from '@/features/mapping/extensions/modules/nodes/geonames/client'
import EnrichNode from '@/features/mapping/components/canvas/EnrichNode.vue'
import GeoNamesEnrichmentPanel from '@/features/mapping/components/setup/GeoNamesEnrichmentPanel.vue'

vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))

const stubs = {
  Handle: { props: ['id'], template: '<i :data-port="id" />' },
  Select: {
    props: ['modelValue', 'options', 'optionLabel', 'optionValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option[optionValue]" :value="option[optionValue]">{{ option[optionLabel] }}</option></select>',
  },
  InputText: true,
  Button: { props: ['label'], template: '<button>{{ label }}</button>' },
  Tag: { props: ['value'], template: '<span class="input-tag">{{ value }}</span>' },
  Listbox: { props: ['modelValue', 'options'], template: '<div />' },
  Message: { template: '<div><slot /></div>' },
}

describe('GeoNames input modes', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const mappingStore = useMappingStore()
    const dataStore = useDataStore()
    const source = csvSource('places', 'Places', ['id', 'place', 'lat', 'lng'], [
      ['1', 'Vancouver', 49, -123], ['2', 'Unknown', '', ''],
    ], ['row-1', 'row-2'])
    dataStore.upsertSource(source)
    const node = addGeoNamesNode(mappingStore)
    const context = { mappingStore, dataStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    const canvasContext = {
      ...context, visibleSources: [source], openSetupDialog: vi.fn(), openNodePreview: vi.fn(), deleteNode: vi.fn(),
      isRefreshingSourceGroup: () => false, refreshSourceGroup: vi.fn(async () => {}), setSourceGroupEdgeVisibility: vi.fn(), runNode: vi.fn(async () => {}),
    }
    const canvasNode = () => buildExtensionCanvasNodes(canvasContext).find(candidate => candidate.id === node.id)!
    const handler = geoNamesModule.connectionHandlers![0]!
    const connect = (header: string, targetHandle: string, sourceId = source.id) => handler.connect({
      source: `src:${sourceId}`, sourceHandle: `h:${header}`, target: node.id, targetHandle,
    }, context)
    return { ...context, context, canvasNode, connect, handler, node }
  }

  function mockLookups() {
    return vi.spyOn(client, 'fetchGeoNameFeatures').mockImplementation(async values => ({
      results: Object.fromEntries(values.map(value => [value, client.normalizeGeoNameFeature({ geonameId: 99, name: `Resolved ${value}` })])),
      lookupErrors: [], totalCount: values.length, processedCount: values.length, cachedCount: 0,
    }))
  }

  it('changes the visible ports using the dropdown on the canvas', async () => {
    const { canvasNode, mappingStore, node, connect } = setup()
    const wrapper = mount(EnrichNode, { props: { data: canvasNode().data }, global: { stubs } })
    expect(wrapper.find('[data-port="geo-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-port="geo-text-input"]').exists()).toBe(false)
    expect(wrapper.find('select').findAll('option')).toHaveLength(3)

    await wrapper.find('select').setValue('coordinates')
    await wrapper.setProps({ data: canvasNode().data })
    expect(getGeoNamesInputMode(mappingStore, node.id)).toBe('coordinates')
    expect(wrapper.find('[data-port="geo-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-port="geo-lat-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-port="geo-lng-input"]').exists()).toBe(true)
    expect(connect('place', 'geo-text-input')).toBe(false)

    await wrapper.find('select').setValue('text')
    await wrapper.setProps({ data: canvasNode().data })
    expect(wrapper.find('[data-port="geo-lat-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-port="geo-text-input"]').exists()).toBe(true)
  })

  it('changes the input fields in configuration and saves the selected mode', async () => {
    const { node, mappingStore } = setup()
    const wrapper = mount(GeoNamesEnrichmentPanel, { props: { nodeId: node.id }, global: { stubs } })
    expect(wrapper.find('select').element.value).toBe('id')
    await wrapper.find('select').setValue('coordinates')
    const tags = wrapper.findAll('.input-tag').map(tag => tag.text())
    expect(tags).toContain('Latitude')
    expect(tags).toContain('Longitude')
    expect(tags).not.toContain('GeoNames ID')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(getGeoNamesInputMode(mappingStore, node.id)).toBe('coordinates')
  })

  it('infers free text from old connections even if the previous run used IDs', () => {
    const { node, mappingStore, canvasNode } = setup()
    updateGeoNamesNode(mappingStore, useDataStore(), node.id, { inputType: 'id' })
    mappingStore.upsertExtensionUiEdge('node.geonames.uiEdges', {
      id: 'geo-ui:legacy', source: 'src:places', sourceHandle: 'h:place', target: node.id, targetHandle: 'geo-text-input',
    })
    expect(canvasNode().data.inputMode).toBe('text')
    expect(canvasNode().data.inputs).toEqual([{ id: 'geo-text-input', label: 'Free text' }])
    const snapshot = mappingStore.createSnapshot()
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(getGeoNamesInputMode(mappingStore, node.id)).toBe('text')
  })

  it('requires latitude and longitude from the same table and preserves both connections', async () => {
    const { canvasNode, connect, node, context, mappingStore } = setup()
    const fetchMock = mockLookups()
    canvasNode().data.onInputModeChange('coordinates')
    connect('lat', 'geo-lat-input')
    await expect(runGeoNamesNode(mappingStore, context.dataStore, node.id, context.sources)).rejects.toThrow('Connect both latitude and longitude')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(connect('lng', 'geo-lng-input', 'another-table')).toBe(true)
    expect(context.toast.add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Latitude and longitude must come from the same source table.' }))
    expect(getGeoNamesInputEdges(mappingStore, node.id)).toHaveLength(1)
    connect('lng', 'geo-lng-input')
    expect(getGeoNamesInputEdges(mappingStore, node.id)).toHaveLength(2)
    await runGeoNamesNode(mappingStore, context.dataStore, node.id, context.sources)
    expect(fetchMock).toHaveBeenCalledWith(['49, -123'], 'demo-user', expect.objectContaining({ inputType: 'coordinates' }))
  })

  it('clears incompatible results when switching modes', async () => {
    const { canvasNode, connect, node, context, mappingStore, dataStore, handler } = setup()
    mockLookups()
    connect('id', 'geo-input')
    handler.connect({ source: node.id, sourceHandle: 'h:name', target: 'shape:Place', targetHandle: 'p:label' }, context)
    await runGeoNamesNode(mappingStore, dataStore, node.id, context.sources)
    const outputId = getGeoNamesNode(mappingStore, node.id)!.outputSourceId!
    expect(dataStore.findById(outputId)).toBeTruthy()
    expect(mappingStore.state.edges).toHaveLength(1)

    canvasNode().data.onInputModeChange('coordinates')
    expect(getGeoNamesInputEdges(mappingStore, node.id)).toHaveLength(0)
    expect(dataStore.findById(outputId)).toBeUndefined()
    expect(mappingStore.state.edges).toHaveLength(0)
    expect(getGeoNamesUiEdges(mappingStore).filter(edge => edge.source === node.id)).toHaveLength(1)
    connect('lat', 'geo-lat-input')
    connect('lng', 'geo-lng-input')
    await runGeoNamesNode(mappingStore, dataStore, node.id, context.sources)
    expect(mappingStore.state.edges).toHaveLength(1)
    canvasNode().data.onInputModeChange('text')
    expect(getGeoNamesInputEdges(mappingStore, node.id)).toHaveLength(0)
    expect(getGeoNamesNode(mappingStore, node.id)).toMatchObject({ status: 'idle', results: {} })
    expect(dataStore.findById(outputId)).toBeUndefined()
  })

  it('selects exactly the five requested output fields for a new node', async () => {
    const mappingStore = useMappingStore()
    const wrapper = mount(GeoNamesEnrichmentPanel, { global: { stubs } })
    const expected = ['name', 'id', 'lat', 'lng', 'countryName']
    expect(wrapper.findComponent(Listbox).props('modelValue')).toEqual(expected)
    expect(wrapper.findAll('.input-tag').map(tag => tag.text())).toEqual([
      'GeoNames ID', 'Name', 'ID', 'Latitude', 'Longitude', 'Country name',
    ])
    wrapper.findComponent(InputText).vm.$emit('update:modelValue', 'demo-user')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    const nodes = mappingStore.getExtensionState('node.geonames.nodes', [] as Array<{ selectedOutputs: string[] }>)
    expect(nodes[0]?.selectedOutputs).toEqual(expected)
  })

  it('restores the removed coordinate option as the single latitude/longitude mode', () => {
    const { mappingStore, node } = setup()
    const snapshot = mappingStore.createSnapshot()
    const saved = (snapshot.extensionState['node.geonames'] as { nodes: Array<Record<string, unknown>> }).nodes[0]!
    saved.inputMode = 'nearby-place'
    saved.inputType = 'nearby-place'
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(getGeoNamesNode(mappingStore, node.id)).toMatchObject({ inputMode: 'coordinates', inputType: 'coordinates' })
    expect(getGeoNamesInputMode(mappingStore, node.id)).toBe('coordinates')
  })

  it('restores coordinates and rebuilds output using both columns after saving the project', async () => {
    const { canvasNode, connect, node, context, mappingStore, dataStore } = setup()
    mockLookups()
    canvasNode().data.onInputModeChange('coordinates')
    connect('lng', 'geo-lng-input')
    connect('lat', 'geo-lat-input')
    await runGeoNamesNode(mappingStore, dataStore, node.id, context.sources)
    const snapshot = mappingStore.createSnapshot()
    const sources = dataStore.createSnapshot()
    mappingStore.reset()
    dataStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    dataStore.restoreSnapshot(sources)

    expect(getGeoNamesNode(mappingStore, node.id)).toMatchObject({ inputMode: 'coordinates', inputType: 'coordinates', inputHeader: 'lat', inputLongitudeHeader: 'lng' })
    updateGeoNamesNode(mappingStore, dataStore, node.id, { selectedOutputs: ['name'] })
    const outputId = materializeGeoNamesOutputSource(mappingStore, dataStore, node.id, dataStore.sources)!
    expect(dataStore.findById(outputId)).toMatchObject({ headers: ['name'], rows: [['Resolved 49, -123'], ['']], recordIds: ['row-1', 'row-2'] })
  })
})
