import { defineAsyncComponent, markRaw } from 'vue'
import { mappingEnrichmentNodeId } from '@/domain/Mapping'
import { CANVAS_EDGE_STYLES } from '@/features/mapping/canvasTheme'
import { createMappingExtensionModule } from '@/features/mapping/extensions/core/createMappingExtensionModule'
import { createNodeSnapshotHandler, getExtensionNodes } from '@/features/mapping/extensions/core/stateHelpers'
import { wouldCreateTextCycle } from '@/features/mapping/extensions/core/textTransformGraph'
import type { SplitMode, SplitNodeConfig, SplitUiEdge } from './types'
import { createSplitNode, getSplitUiEdges, materializeSplitOutputSource, resolveSplitInput, splitOutputHeaders, syncSplitShapeMappings, updateSplitNode, SPLIT_NODE_STATE_KEY, SPLIT_UI_EDGE_STATE_KEY } from './workflow'

const TransformNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/TransformNode.vue'))

export const splitModule = createMappingExtensionModule({
  id: 'node.split',
  mappingNodeActions: [{ id: 'split', label: 'split', icon: 'pi pi-arrows-h', category: 'transformation', createNode: createSplitNode }],
  canvasNodeTypes: { splitNode: markRaw(TransformNode) },
  defaultNodePositions: { splitNode: { x: 620, y: 40 } },
  canvasModules: [{
    id: 'split',
    buildNodes: context => getExtensionNodes<SplitNodeConfig>(context, SPLIT_NODE_STATE_KEY).map(node => {
      const input = getSplitUiEdges(context.mappingStore).find(edge => edge.target === node.id)
      return {
        id: node.id, type: 'splitNode', position: { x: 0, y: 0 }, data: {
          title: 'split', subtitle: 'Split a field into columns or an array', icon: 'pi pi-arrows-h',
          inputs: [{ id: 'split-input', label: 'Input', state: input ? 'connected' : 'pending', stateLabel: input?.sourceHandle.slice(2) ?? 'pending' }],
          outputs: splitOutputHeaders(node).map(header => ({ id: `h:${header}`, label: header === 'values' ? 'Values (array)' : header === 'first' ? 'First part' : 'Remaining text' })),
          separator: node.separator, onSeparatorChange: (separator: string) => updateSplitNode(node.id, { separator }, { ...context, sources: context.dataStore.sources }),
          mode: node.mode, modeOptions: [{ value: 'columns', label: 'Two columns' }, { value: 'array', label: 'Array' }],
          onModeChange: (mode: SplitMode) => updateSplitNode(node.id, { mode }, { ...context, sources: context.dataStore.sources }),
          note: !node.separator ? 'Enter a separator.' : node.mode === 'array'
            ? 'Existing arrays keep their elements. Text is split at every separator.'
            : 'Split at the first separator. Missing parts stay empty; remaining text stays in the second column.',
          onPreview: () => context.openNodePreview(node.id), onDelete: () => context.deleteNode(node.id),
        },
      }
    }),
    buildEdges: context => getSplitUiEdges(context.mappingStore).filter(edge => !edge.target.startsWith('shape:')).map(edge => ({ ...edge, animated: false, style: CANVAS_EDGE_STYLES.primaryDashed })),
  }],
  mappingEdgeSourceHandlers: [{
    id: 'node.split.mapping-edge-source', canResolve: edge => Boolean(mappingEnrichmentNodeId(edge, 'split')),
    resolve: edge => ({ source: mappingEnrichmentNodeId(edge, 'split')!, sourceHandle: `h:${edge.sourceHeader}` }),
  }],
  outputSourceHandlers: [{ id: 'node.split.output-source', canResolve: id => id.startsWith('split:'), resolve: materializeSplitOutputSource }],
  previewHandlers: [{
    id: 'node.split.preview', canPreview: id => id.startsWith('split:'), preview: (id, context) => {
      try {
        const { source, header, index, node } = resolveSplitInput(context, id)
        // Validate object-valued rows before displaying an empty output.
        const outputId = materializeSplitOutputSource(id, context)
        if (!outputId) throw new Error('Extract a text or ID field from objects before splitting.')
        context.openPairedSourcePreview({ ...source, id: `${node.id}:input-preview`, name: 'split input', headers: [header], rows: source.rows.map(row => [row[index]]) }, context.dataStore.findById(outputId) ?? null)
      } catch (error) {
        context.toast.add({ severity: 'warn', summary: 'Split incomplete', detail: error instanceof Error ? error.message : String(error), life: 4000 })
      }
    },
  }],
  connectionHandlers: [{
    id: 'node.split.connections',
    canHandleConnection: connection => Boolean(connection.target?.startsWith('split:') || (connection.source?.startsWith('split:') && connection.target?.startsWith('shape:'))),
    connect: (connection, context) => {
      const sourceHandle = connection.sourceHandle ?? ''
      const targetHandle = connection.targetHandle ?? ''
      if (!sourceHandle.startsWith('h:') || !connection.source || !connection.target) return false
      if (/^(src:|geonames:|merge:|split:|hash:)/.test(connection.source) && connection.target.startsWith('split:')) {
        if (targetHandle !== 'split-input' || !context.mappingStore.findExtensionNode(SPLIT_NODE_STATE_KEY, connection.target)) return false
        if (wouldCreateTextCycle(connection.source, connection.target, context.mappingStore)) {
          context.toast.add({ severity: 'warn', summary: 'Connection would create a cycle', life: 4000 })
          return true
        }
        context.mappingStore.upsertExtensionUiEdge(SPLIT_UI_EDGE_STATE_KEY, { id: `split-ui:${connection.target}:input`, source: connection.source, sourceHandle, target: connection.target, targetHandle })
        syncSplitShapeMappings(connection.target, context)
        return true
      }
      if (connection.source.startsWith('split:') && connection.target.startsWith('shape:')) {
        const node = context.mappingStore.findExtensionNode<SplitNodeConfig>(SPLIT_NODE_STATE_KEY, connection.source)
        if (!node || !splitOutputHeaders(node).includes(sourceHandle.slice(2)) || !targetHandle.startsWith('p:')) return false
        context.mappingStore.upsertExtensionUiEdge(SPLIT_UI_EDGE_STATE_KEY, { id: `split-ui:${connection.source}:${sourceHandle}->${connection.target}:${targetHandle}`, source: connection.source, sourceHandle, target: connection.target, targetHandle })
        syncSplitShapeMappings(connection.source, context)
        return true
      }
      return false
    },
    deleteUiEdge: (id, context) => {
      if (!id.startsWith('split-ui:')) return false
      const { removed } = context.mappingStore.removeExtensionUiEdge(SPLIT_UI_EDGE_STATE_KEY, id)
      if (removed) syncSplitShapeMappings(removed.target.startsWith('split:') ? removed.target : removed.source, context)
      return true
    },
    deleteMappingEdge: (edge, shapeIri, propertyPath, context) => {
      const id = mappingEnrichmentNodeId(edge, 'split')
      if (!id) return false
      const connection = getSplitUiEdges(context.mappingStore).find(item => item.source === id && item.target === `shape:${shapeIri}` && item.targetHandle === `p:${propertyPath}`)
      if (!connection) return false
      context.mappingStore.removeExtensionUiEdge(SPLIT_UI_EDGE_STATE_KEY, connection.id)
      syncSplitShapeMappings(id, context)
      return true
    },
  }],
  snapshotHandlers: [createNodeSnapshotHandler<SplitNodeConfig, SplitUiEdge>({ id: 'node.split', nodeStateKey: SPLIT_NODE_STATE_KEY, uiEdgeStateKey: SPLIT_UI_EDGE_STATE_KEY, cloneNode: node => ({ ...node }) })],
})
