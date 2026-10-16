import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { buildExtensionCanvasNodes, resolveMappingEdgeCanvasSource, resolveMaterializedNodeOutputSource } from '@/features/mapping/mappingExtensionRegistry'
import { useCanvasGraph } from '@/features/mapping/useCanvasGraph'
import TransformNode from '@/features/mapping/components/canvas/TransformNode.vue'
import { hashModule } from '@/features/mapping/extensions/modules/nodes/hash'
import { createHashNode, deleteHashNode, getHashUiEdges, hashValue } from '@/features/mapping/extensions/modules/nodes/hash/workflow'
import { splitModule } from '@/features/mapping/extensions/modules/nodes/split'
import { createSplitNode, deleteSplitNode, updateSplitNode } from '@/features/mapping/extensions/modules/nodes/split/workflow'
import { mergeModule } from '@/features/mapping/extensions/modules/nodes/merge'
import { createMergeNode } from '@/features/mapping/extensions/modules/nodes/merge/workflow'
import { refreshTextTransforms } from '@/features/mapping/extensions/core/textTransformGraph'
import { addGeoNamesNode } from '@/test/mappingExtensionFixtures'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe('HASH transformation', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function setup() {
    const dataStore = useDataStore()
    const mappingStore = useMappingStore()
    const source = csvSource('names', 'Architects', ['name'], [['XY Architects'], [' XY Architects '], ['Other Architects'], ['']], ['r1', 'r2', 'r3', 'r4'])
    dataStore.upsertSource(source)
    const node = createHashNode(mappingStore)
    const context = { dataStore, mappingStore, sources: dataStore.sources, toast: { add: vi.fn() } }
    const handler = hashModule.connectionHandlers![0]!
    const connect = (upstream = `src:${source.id}`, header = 'name') => handler.connect({ source: upstream, sourceHandle: `h:${header}`, target: node.id, targetHandle: 'hash-input' }, context)
    const map = () => handler.connect({ source: node.id, sourceHandle: 'h:hash', target: 'shape:Architect', targetHandle: 'p:id' }, context)
    const output = () => dataStore.findById(`hash-output:${node.id}`)!
    const canvasContext = { ...context, visibleSources: [source], openSetupDialog: vi.fn(), openNodePreview: vi.fn(), deleteNode: vi.fn(), isRefreshingSourceGroup: () => false, refreshSourceGroup: vi.fn(async () => {}), setSourceGroupEdgeVisibility: vi.fn(), runNode: vi.fn(async () => {}) }
    return { dataStore, mappingStore, source, node, context, handler, connect, map, output, canvasContext }
  }

  it('matches SHA-256 vectors and UTF-8 text, trims outer whitespace and preserves case and inner spaces', () => {
    expect(hashValue('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const name of ['XY Architects', 'Müller & Söhne 建築 🏛️', 'x'.repeat(1000)]) expect(hashValue(name)).toBe(digest(name))
    expect(hashValue('  XY Architects\n')).toBe(hashValue('XY Architects'))
    expect(hashValue('xy architects')).not.toBe(hashValue('XY Architects'))
    expect(hashValue('XY  Architects')).not.toBe(hashValue('XY Architects'))
    expect(hashValue('XY Architects')).toMatch(/^[a-f0-9]{64}$/)
    expect(hashValue(0)).toBe(digest('0'))
    expect(hashValue(false)).toBe(digest('false'))
  })

  it('keeps empty inputs empty and hashes arrays element by element with stable positions', () => {
    for (const input of ['', ' \n ', null, undefined]) expect(hashValue(input)).toBe('')
    expect(hashValue([])).toEqual([])
    expect(hashValue(['XY Architects', '', null, 'XY Architects', 'Other'])).toEqual([digest('XY Architects'), '', '', digest('XY Architects'), digest('Other')])
    for (const input of [{ name: 'XY' }, [{ name: 'XY' }], [['XY']]]) expect(() => hashValue(input)).toThrow('Extract a text or ID field')
  })

  it('renders a HASH node, previews input beside output, and restores reproducible values and row lineage from a snapshot', async () => {
    const { node, context, source, connect, map, output, mappingStore, dataStore, canvasContext } = setup()
    connect()
    map()
    expect(output()).toMatchObject({ headers: ['hash'], recordIds: source.recordIds, origin: { inputSourceId: source.id }, rows: [[digest('XY Architects')], [digest('XY Architects')], [digest('Other Architects')], ['']] })
    expect(resolveMappingEdgeCanvasSource(mappingStore.state.edges[0])).toEqual({ source: node.id, sourceHandle: 'h:hash' })
    const canvas = buildExtensionCanvasNodes(canvasContext).find(item => item.id === node.id)!
    const wrapper = mount(TransformNode, { props: { data: canvas.data }, global: { stubs: { Handle: true, Button: true } } })
    expect(wrapper.text()).toContain('HASH')
    expect(wrapper.text()).toContain('SHA-256')
    expect(wrapper.text()).toContain('case is preserved')
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.find('[aria-label="Preview transform"]').trigger('click')
    expect(canvasContext.openNodePreview).toHaveBeenCalledWith(node.id)
    const openPairedSourcePreview = vi.fn()
    hashModule.previewHandlers![0].preview(node.id, { ...context, openPairedSourcePreview, openTablePreview: vi.fn() })
    expect(openPairedSourcePreview).toHaveBeenCalledWith(expect.objectContaining({ rows: source.rows }), expect.objectContaining({ rows: output().rows }))
    const snapshot = mappingStore.createSnapshot()
    const before = output().rows.map(row => [...row])
    mappingStore.reset()
    dataStore.removeNodeOutputSources(node.id)
    mappingStore.restoreSnapshot(snapshot)
    expect(resolveMaterializedNodeOutputSource(node.id, { ...context, sources: dataStore.sources })).toBe(`hash-output:${node.id}`)
    expect(output().rows).toEqual(before)
    wrapper.unmount()
  })

  it('chains split → HASH → merge, refreshes downstream values and clears descendants when the upstream output disappears', () => {
    const { node, context, connect, output, dataStore, mappingStore, source } = setup()
    dataStore.upsertSource(csvSource(source.id, source.name, source.headers, [['XY Architects|Other'], ['']], ['r1', 'r2']))
    const split = createSplitNode(mappingStore)
    updateSplitNode(split.id, { mode: 'array', separator: '|' }, context)
    splitModule.connectionHandlers![0].connect({ source: `src:${source.id}`, sourceHandle: 'h:name', target: split.id, targetHandle: 'split-input' }, context)
    connect(split.id, 'values')
    expect(output().rows).toEqual([[[digest('XY Architects'), digest('Other')]], [[]]])
    const merge = createMergeNode(mappingStore)
    for (const port of [1, 2]) mergeModule.connectionHandlers![0].connect({ source: node.id, sourceHandle: 'h:hash', target: merge.id, targetHandle: `merge-input-${port}` }, context)
    expect(dataStore.findById(`merge-output:${merge.id}`)!.rows[0]).toEqual([[digest('XY Architects'), digest('Other'), digest('XY Architects'), digest('Other')].join(', ')])
    dataStore.upsertSource(csvSource(source.id, source.name, source.headers, [['New']], ['new-record']))
    refreshTextTransforms({ ...context, sources: dataStore.sources })
    expect(output().rows).toEqual([[[digest('New')]]])
    expect(output().recordIds).toEqual(['new-record'])
    deleteSplitNode(split.id, { ...context, sources: dataStore.sources })
    expect(output()).toBeUndefined()
    expect(dataStore.findById(`merge-output:${merge.id}`)).toBeUndefined()
  })

  it('rejects direct and indirect cycles and deletes HASH connections and dependent outputs', () => {
    const { node, context, connect, map, mappingStore, dataStore, source } = setup()
    connect()
    map()
    connect(node.id, 'hash')
    const split = createSplitNode(mappingStore)
    splitModule.connectionHandlers![0].connect({ source: node.id, sourceHandle: 'h:hash', target: split.id, targetHandle: 'split-input' }, context)
    connect(split.id, 'first')
    expect(context.toast.add).toHaveBeenCalledTimes(2)
    expect(getHashUiEdges(mappingStore).find(edge => edge.target === node.id)!.source).toBe(`src:${source.id}`)
    expect(dataStore.findById(`split-output:${split.id}`)).toBeDefined()
    deleteHashNode(node.id, context)
    expect(dataStore.findById(`hash-output:${node.id}`)).toBeUndefined()
    expect(dataStore.findById(`split-output:${split.id}`)).toBeUndefined()
    expect(mappingStore.state.edges).toEqual([])
    expect(getHashUiEdges(mappingStore)).toEqual([])
  })

  it('clears stale mappings on disconnect or invalid input, reports object inputs, and recovers when a scalar field returns', () => {
    const { node, context, connect, map, output, handler, mappingStore, dataStore, source } = setup()
    connect()
    map()
    const input = getHashUiEdges(mappingStore).find(edge => edge.target === node.id)!
    handler.deleteUiEdge!(input.id, context)
    expect(output()).toBeUndefined()
    expect(mappingStore.state.edges).toEqual([])
    dataStore.upsertSource(csvSource(source.id, source.name, source.headers, [[{ name: 'XY' }]], ['r1']))
    connect()
    const previewContext = { ...context, openPairedSourcePreview: vi.fn(), openTablePreview: vi.fn() }
    hashModule.previewHandlers![0].preview(node.id, previewContext)
    expect(context.toast.add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'HASH incomplete', detail: expect.stringContaining('Extract a text or ID field') }))
    expect(previewContext.openPairedSourcePreview).not.toHaveBeenCalled()
    dataStore.upsertSource(source)
    connect()
    expect(output().rows[0]).toEqual([digest('XY Architects')])
    expect(mappingStore.state.edges).toHaveLength(1)
  })

  it('refreshes hashes when the canvas source changes and deletes the node through its canvas action', async () => {
    const { connect, output, source, node, context, dataStore, mappingStore } = setup()
    connect()
    const confirm = { require: vi.fn(options => options.accept()) }
    const wrapper = mount(defineComponent({ setup() {
      const graph = useCanvasGraph({ dataStore, mappingStore, sources: computed(() => dataStore.sources), canvasShapes: ref([]),
        toast: context.toast, confirm, openSetupDialog: vi.fn(), openTablePreview: vi.fn(), openNodePreview: vi.fn(), openShapePreview: vi.fn() })
      return () => h('button', { onClick: () => graph.nodes.value.find(item => item.id === node.id)!.data.onDelete() })
    } }))
    dataStore.upsertSource(csvSource(source.id, source.name, source.headers, [['Changed']], ['r9']))
    await nextTick()
    expect(output().rows).toEqual([[digest('Changed')]])
    expect(output().recordIds).toEqual(['r9'])
    await wrapper.find('button').trigger('click')
    expect(output()).toBeUndefined()
    expect(confirm.require).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('accepts GeoNames output, allows HASH to feed GeoNames, and rejects their feedback cycle', () => {
    const { node, context, connect, output, mappingStore, dataStore } = setup()
    const geo = addGeoNamesNode(mappingStore)
    const sourceId = dataStore.addNodeOutputSource('geonames', geo.id, ['name'], [['Berlin']], ['r1'], 'names')
    mappingStore.updateExtensionNode('node.geonames.nodes', geo.id, current => ({ ...current, outputSourceId: sourceId }))
    connect(geo.id, 'name')
    expect(output().rows).toEqual([[digest('Berlin')]])
    const geoHandler = geoNamesModule.connectionHandlers![0]
    geoHandler.connect({ source: node.id, sourceHandle: 'h:hash', target: geo.id, targetHandle: 'geo-input' }, context)
    expect(context.toast.add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Connection would create a cycle' }))
    connect()
    expect(geoHandler.connect({ source: node.id, sourceHandle: 'h:hash', target: geo.id, targetHandle: 'geo-input' }, context)).toBe(true)
  })
})
