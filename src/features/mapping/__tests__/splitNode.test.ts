import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { useCanvasGraph } from '@/features/mapping/useCanvasGraph'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { splitModule } from '@/features/mapping/extensions/modules/nodes/split'
import { createSplitNode, deleteSplitNode, getSplitUiEdges, materializeSplitOutputSource, splitValues, updateSplitNode } from '@/features/mapping/extensions/modules/nodes/split/workflow'
import { mergeModule } from '@/features/mapping/extensions/modules/nodes/merge'
import { createMergeNode, deleteMergeNode } from '@/features/mapping/extensions/modules/nodes/merge/workflow'
import { refreshTextTransforms } from '@/features/mapping/extensions/core/textTransformGraph'
import { buildExtensionCanvasNodes } from '@/features/mapping/mappingExtensionRegistry'
import TransformNode from '@/features/mapping/components/canvas/TransformNode.vue'
import { AirtableService } from '@/features/mapping/extensions/modules/source-data/airtable/client'
import { createAirtableDataSource } from '@/features/mapping/extensions/modules/source-data/airtable/workflow'
import { addGeoNamesNode } from '@/test/mappingExtensionFixtures'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'
import { getGeoNamesUiEdges, runGeoNamesNode, updateGeoNamesNode } from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import * as geoClient from '@/features/mapping/extensions/modules/nodes/geonames/client'
import { importCsvFiles } from '@/features/mapping/extensions/modules/source-data/csv-file/workflow'

describe('split node and text transformation chains', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const dataStore = useDataStore()
    const mappingStore = useMappingStore()
    const source = csvSource('places', 'Places', ['id', 'text', 'city', 'country'], [
      ['r1', 'Berlin, Germany', 'Berlin', 'Germany'],
      ['r2', 'Vancouver', 'Vancouver', 'Canada'],
      ['r3', '', '', ''],
      ['r4', 'Paris, France, Europe', 'Paris', 'France'],
      ['r5', ', Japan', '', 'Japan'],
    ], ['rec1', 'rec2', 'rec3', 'rec4', 'rec5'])
    dataStore.upsertSource(source)
    const node = createSplitNode(mappingStore)
    const context = { dataStore, mappingStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    const handler = splitModule.connectionHandlers![0]!
    const connect = (upstream = `src:${source.id}`, header = 'text') => handler.connect({ source: upstream, sourceHandle: `h:${header}`, target: node.id, targetHandle: 'split-input' }, context)
    const mapOutput = (header: string, property = header) => handler.connect({ source: node.id, sourceHandle: `h:${header}`, target: 'shape:Place', targetHandle: `p:${property}` }, context)
    const canvasContext = { ...context, visibleSources: [source], openSetupDialog: vi.fn(), openNodePreview: vi.fn(), deleteNode: vi.fn(), isRefreshingSourceGroup: () => false, refreshSourceGroup: vi.fn(async () => {}), setSourceGroupEdgeVisibility: vi.fn(), runNode: vi.fn(async () => {}) }
    const canvasNode = () => buildExtensionCanvasNodes(canvasContext).find(item => item.id === node.id)!
    const output = () => dataStore.findById(`split-output:${node.id}`)!
    return { dataStore, mappingStore, source, node, context, handler, connect, mapOutput, canvasNode, canvasContext, output }
  }

  it('creates two columns of the original length, with stable row IDs and the remaining text intact', () => {
    const { connect, output, source, mapOutput, mappingStore } = setup()
    expect(connect()).toBe(true)
    mapOutput('first')
    mapOutput('second')
    expect(output()).toMatchObject({ headers: ['first', 'second'], rows: [
      ['Berlin', 'Germany'], ['Vancouver', ''], ['', ''], ['Paris', 'France, Europe'], ['', 'Japan'],
    ], recordIds: source.recordIds, origin: { inputSourceId: source.id } })
    expect(mappingStore.state.edges.map(edge => edge.sourceHeader)).toEqual(['first', 'second'])
  })

  it('edits the separator and output mode on the canvas and removes incompatible output mappings', async () => {
    const { connect, output, canvasNode, mapOutput, context, node } = setup()
    connect()
    mapOutput('first')
    const wrapper = mount(TransformNode, { props: { data: canvasNode().data }, global: { stubs: { Handle: true, Button: true } } })
    await wrapper.find('input[aria-label="Separator"]').setValue(',')
    expect(output().rows[3]).toEqual(['Paris', 'France, Europe'])
    await wrapper.find('select').setValue('array')
    await wrapper.setProps({ data: canvasNode().data })
    expect(output().headers).toEqual(['values'])
    expect(output().rows).toHaveLength(5)
    expect(output().rows[3]).toEqual([['Paris', 'France', 'Europe']])
    expect(output().rows[4]).toEqual([['', 'Japan']])
    expect(output().rows[2]).toEqual([[]])
    expect(context.mappingStore.state.edges).toEqual([])
    expect(getSplitUiEdges(context.mappingStore).filter(edge => edge.source === node.id)).toEqual([])
    expect(mapOutput('first')).toBe(false)
    expect(mapOutput('values')).toBe(true)
    await wrapper.find('input').setValue('')
    expect(materializeSplitOutputSource(node.id, context)).toBeUndefined()
    expect(context.mappingStore.state.edges).toEqual([])
    await wrapper.setProps({ data: canvasNode().data })
    expect(wrapper.text()).toContain('Enter a separator.')
  })

  it('preserves Airtable array elements, including commas and empty positions, and saves them without aliasing', () => {
    const { connect, output, node, context, dataStore, mappingStore } = setup()
    const table = AirtableService.recordsToTable([
      { id: 'recA', fields: { Tags: ['Berlin, Germany', 'Paris', ''], Other: 'x' } },
      { id: 'recB', fields: { Tags: [], Other: 'y' } },
    ])
    const airtable = createAirtableDataSource({ baseId: 'base', tableId: 'table', tableName: 'Tags', ...table })
    dataStore.upsertSource(airtable)
    updateSplitNode(node.id, { mode: 'array', separator: ',' }, context)
    connect(`src:${airtable.id}`, 'Tags')
    expect(output().rows).toEqual([[['Berlin, Germany', 'Paris', '']], [[]]])
    expect(output().recordIds).toEqual(['recA', 'recB'])
    const sourceSnapshot = dataStore.createSnapshot()
    const mappingSnapshot = mappingStore.createSnapshot()
    ;(output().rows[0][0] as string[])[0] = 'changed'
    dataStore.reset()
    mappingStore.reset()
    dataStore.restoreSnapshot(sourceSnapshot)
    mappingStore.restoreSnapshot(mappingSnapshot)
    expect(dataStore.findById(`split-output:${node.id}`)!.rows[0]).toEqual([['Berlin, Germany', 'Paris', '']])
    expect(materializeSplitOutputSource(node.id, { ...context, sources: dataStore.sources })).toBe(`split-output:${node.id}`)
    expect(output().rows[0]).toEqual([['Berlin, Germany', 'Paris', '']])
  })

  it('treats delimiters literally and handles existing arrays without splitting their elements again', () => {
    expect(splitValues('a.*b.*c', 'columns', '.*')).toEqual(['a', 'b.*c'])
    expect(splitValues('a.*b.*c', 'array', '.*')).toEqual([['a', 'b', 'c']])
    expect(splitValues(['a,b', '', 'c'], 'columns', '|')).toEqual(['a,b', '|c'])
    expect(splitValues(0, 'array', ',')).toEqual([['0']])
    expect(splitValues(false, 'columns', ',')).toEqual(['false', ''])
    expect(() => splitValues([{ id: 'x' }], 'array', ',')).toThrow('Extract a text or ID field')
  })

  it('uses a single literal space from the input for both split modes', async () => {
    const { node, context, connect, output, canvasNode, dataStore, source } = setup()
    dataStore.upsertSource(csvSource(source.id, source.name, ['text'], [['52.5 13.4'], ['Berlin Germany Europe']], ['a', 'b']))
    connect()
    const wrapper = mount(TransformNode, { props: { data: canvasNode().data }, global: { stubs: { Handle: true, Button: true } } })
    await wrapper.find('input').setValue(' ')
    await wrapper.setProps({ data: canvasNode().data })
    expect(wrapper.find('input').element.value).toBe(' ')
    expect(output().rows).toEqual([['52.5', '13.4'], ['Berlin', 'Germany Europe']])
    updateSplitNode(node.id, { mode: 'array' }, context)
    expect(output().rows).toEqual([[['52.5', '13.4']], [['Berlin', 'Germany', 'Europe']]])
  })

  it('splits a CSV cell containing line-separated URLs using the Line break preset or typed \\n', async () => {
    const { node, context, connect, output, canvasNode, dataStore, mappingStore } = setup()
    const urls = [
      'https://www.nextroom.at/building.php?id=28438',
      'https://2015.wienwood.at/05/projekte/wohnbau-spoettelgasse.htm',
      'https://2015.wienwood.at/05/projekte/wohnbau-spoettelgasse.htm',
    ]
    await importCsvFiles(dataStore, [new File([
      `_recordId,text\r\nrec1,"${urls.join('\n')}"\r\nrec2,"${urls.join('\r\n')}"\r\n`,
    ], 'links.csv', { type: 'text/csv' })])
    connect('src:links.csv', 'text')
    updateSplitNode(node.id, { mode: 'array' }, context)
    const wrapper = mount(TransformNode, { props: { data: canvasNode().data }, global: { stubs: { Handle: true, Button: true } } })
    const newlineButton = wrapper.findAll('button').find(button => button.text() === 'Line break')!
    await newlineButton.trigger('click')
    await wrapper.setProps({ data: canvasNode().data })
    expect(output().rows).toEqual([[urls], [urls]])
    expect(output().recordIds).toEqual(['rec1', 'rec2'])
    expect(wrapper.find('input').element.value).toBe('\\n')
    expect(wrapper.find('.separator-description').text()).toBe('Line break')
    const snapshot = mappingStore.createSnapshot()
    mappingStore.reset()
    mappingStore.restoreSnapshot(snapshot)
    expect(materializeSplitOutputSource(node.id, { ...context, sources: dataStore.sources })).toBe(`split-output:${node.id}`)
    expect(output().rows[0]).toEqual([urls])
    await wrapper.find('input').setValue('\\')
    await wrapper.setProps({ data: canvasNode().data })
    expect(wrapper.find('input').element.value).toBe('\\')
    await wrapper.find('input').setValue('\\n')
    await wrapper.setProps({ data: canvasNode().data })
    expect(output().rows).toEqual([[urls], [urls]])
    await wrapper.find('input').setValue('\\\\n')
    expect(output().rows[0]).toEqual([[urls.join('\n')]]) // escaped backslash means literal backslash+n
  })

  it('chains merge into split, refreshes dependents after separator edits and source refresh, and cleans up deletion', () => {
    const { connect, output, node, context, dataStore, mappingStore, source, canvasContext, mapOutput } = setup()
    const merge = createMergeNode(mappingStore)
    const mergeHandler = mergeModule.connectionHandlers![0]!
    for (const [index, header] of ['city', 'country'].entries()) mergeHandler.connect({ source: `src:${source.id}`, sourceHandle: `h:${header}`, target: merge.id, targetHandle: `merge-input-${index + 1}` }, context)
    const mergeCanvas = () => buildExtensionCanvasNodes(canvasContext).find(item => item.id === merge.id)!
    mergeCanvas().data.onSeparatorChange('|')
    updateSplitNode(node.id, { separator: '|' }, context)
    connect(merge.id, 'merged')
    mapOutput('second')
    expect(output().rows[0]).toEqual(['Berlin', 'Germany'])
    mergeCanvas().data.onSeparatorChange(' / ')
    expect(output().rows[0]).toEqual(['Berlin / Germany', ''])
    updateSplitNode(node.id, { separator: ' / ' }, context)
    dataStore.upsertSource(csvSource(source.id, source.name, source.headers, [['new', '', 'Rome', 'Italy']], ['new-rec']))
    refreshTextTransforms({ ...context, sources: dataStore.sources })
    expect(output().rows).toEqual([['Rome', 'Italy']])
    expect(output().recordIds).toEqual(['new-rec'])
    deleteMergeNode(merge.id, { ...context, sources: dataStore.sources })
    expect(dataStore.findById(`split-output:${node.id}`)).toBeUndefined()
    expect(mappingStore.state.edges).toEqual([])
  })

  it('lets split columns feed merge and rejects direct or indirect cycles', () => {
    const { connect, node, context, mappingStore, dataStore, mapOutput } = setup()
    connect()
    const merge = createMergeNode(mappingStore)
    const mergeHandler = mergeModule.connectionHandlers![0]!
    for (const [index, header] of ['first', 'second'].entries()) mergeHandler.connect({ source: node.id, sourceHandle: `h:${header}`, target: merge.id, targetHandle: `merge-input-${index + 1}` }, context)
    expect(dataStore.findById(`merge-output:${merge.id}`)!.rows[0]).toEqual(['Berlin, Germany'])
    expect(connect(merge.id, 'merged')).toBe(true)
    expect(context.toast.add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Connection would create a cycle' }))
    expect(getSplitUiEdges(mappingStore).find(edge => edge.target === node.id)!.source).toBe('src:places')
    mapOutput('first')
    deleteSplitNode(node.id, context)
    expect(dataStore.findById(`merge-output:${merge.id}`)).toBeUndefined()
    expect(mappingStore.state.edges).toEqual([])
  })

  it('updates the derived rows automatically when an imported source is refreshed on the canvas', async () => {
    const { connect, output, source, dataStore, mappingStore, context } = setup()
    connect()
    const wrapper = mount(defineComponent({ setup() {
      useCanvasGraph({ dataStore, mappingStore, sources: computed(() => dataStore.sources), canvasShapes: ref([]),
        toast: context.toast, confirm: { require: vi.fn() }, openSetupDialog: vi.fn(), openTablePreview: vi.fn(), openNodePreview: vi.fn(), openShapePreview: vi.fn() })
      return () => h('div')
    } }))
    dataStore.upsertSource(csvSource(source.id, source.name, source.headers, [['r9', 'Rome, Italy', '', '']], ['record9']))
    await nextTick()
    expect(output().rows).toEqual([['Rome', 'Italy']])
    expect(output().recordIds).toEqual(['record9'])
    await nextTick()
    wrapper.unmount()
  })

  it('feeds two split columns into GeoNames coordinates and clears results if that output disappears', async () => {
    const { connect, node, context, mappingStore, dataStore, source } = setup()
    dataStore.upsertSource(csvSource(source.id, source.name, ['text'], [['52.5|13.4'], ['|']], ['a', 'b']))
    updateSplitNode(node.id, { separator: '|' }, context)
    connect()
    const geo = addGeoNamesNode(mappingStore)
    updateGeoNamesNode(mappingStore, dataStore, geo.id, { inputMode: 'coordinates' })
    const geoHandler = geoNamesModule.connectionHandlers![0]!
    for (const [header, port] of [['first', 'geo-lat-input'], ['second', 'geo-lng-input']]) geoHandler.connect({ source: node.id, sourceHandle: `h:${header}`, target: geo.id, targetHandle: port }, context)
    vi.spyOn(geoClient, 'fetchGeoNameFeatures').mockResolvedValue({ results: {}, lookupErrors: [], totalCount: 1, processedCount: 1, cachedCount: 0 })
    await runGeoNamesNode(mappingStore, dataStore, geo.id, dataStore.sources)
    expect(geoClient.fetchGeoNameFeatures).toHaveBeenCalledWith(['52.5, 13.4'], 'demo-user', expect.objectContaining({ inputType: 'coordinates' }))
    expect(dataStore.findById(`geonames-output:${geo.id}`)!.recordIds).toEqual(['a', 'b'])
    updateSplitNode(node.id, { mode: 'array' }, context)
    expect(getGeoNamesUiEdges(mappingStore)).toEqual([])
    expect(dataStore.findById(`geonames-output:${geo.id}`)).toBeUndefined()
  })
})
