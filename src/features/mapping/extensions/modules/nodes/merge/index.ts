import { defineAsyncComponent, markRaw } from 'vue'
import { mappingEnrichmentNodeId } from '@/domain/Mapping'
import { CANVAS_EDGE_STYLES } from '@/features/mapping/canvasTheme'
import { createMappingExtensionModule } from '@/features/mapping/extensions/core/createMappingExtensionModule'
import { createNodeSnapshotHandler, getExtensionNodes } from '@/features/mapping/extensions/core/stateHelpers'
import type { MergeNodeConfig, MergeUiEdge } from './types'
import {
  createMergeNode, getMergeInputs, getMergeUiEdges, materializeMergeOutputSource, resolveMergeInput,
  syncMergeShapeMappings, MERGE_NODE_STATE_KEY, MERGE_UI_EDGE_STATE_KEY, MERGE_OUTPUT_HEADER,
  wouldCreateGeoNamesMergeCycle,
} from './workflow'

const TransformNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/TransformNode.vue'))

export const mergeModule = createMappingExtensionModule({
  id: 'node.merge',
  mappingNodeActions: [{ id: 'merge', label: 'merge', icon: 'pi pi-arrows-h', category: 'transformation', createNode: createMergeNode }],
  canvasNodeTypes: { mergeNode: markRaw(TransformNode) },
  defaultNodePositions: { mergeNode: { x: 620, y: 40 } },
  canvasModules: [{
    id: 'merge',
    buildNodes: context => getExtensionNodes<MergeNodeConfig>(context, MERGE_NODE_STATE_KEY).map(node => {
      const inputs = getMergeInputs(context.mappingStore, node.id)
      return {
        id: node.id, type: 'mergeNode', position: { x: 0, y: 0 },
        data: {
          title: 'merge', subtitle: 'Join fields', icon: 'pi pi-arrows-h',
          separator: node.separator ?? ', ',
          onSeparatorChange: (separator: string) => {
            context.mappingStore.updateExtensionNode<MergeNodeConfig>(MERGE_NODE_STATE_KEY, node.id, current => ({ ...current, separator }))
            syncMergeShapeMappings(node.id, { ...context, sources: context.dataStore.sources })
          },
          note: 'Join nonempty values in input order. Array elements use the same separator.',
          inputs: Array.from({ length: node.inputCount }, (_, index) => {
            const id = `merge-input-${index + 1}`
            const input = inputs.find(edge => edge.targetHandle === id)
            return { id, label: `Input ${index + 1}`, state: input ? 'connected' : 'pending', stateLabel: input?.sourceHandle.slice(2) ?? 'pending' }
          }),
          outputs: [{ id: `h:${MERGE_OUTPUT_HEADER}`, label: 'Merged text' }],
          onAddInput: () => context.mappingStore.updateExtensionNode<MergeNodeConfig>(MERGE_NODE_STATE_KEY, node.id,
            current => ({ ...current, inputCount: current.inputCount + 1 })),
          onPreview: () => context.openNodePreview(node.id), onDelete: () => context.deleteNode(node.id),
        },
      }
    }),
    buildEdges: context => getMergeUiEdges(context.mappingStore).filter(edge => !edge.target.startsWith('shape:')).map(edge => ({
      ...edge, animated: false, style: CANVAS_EDGE_STYLES.primaryDashed,
    })),
  }],
  mappingEdgeSourceHandlers: [{
    id: 'node.merge.mapping-edge-source', canResolve: edge => Boolean(mappingEnrichmentNodeId(edge, 'merge')),
    resolve: edge => ({ source: mappingEnrichmentNodeId(edge, 'merge')!, sourceHandle: `h:${MERGE_OUTPUT_HEADER}` }),
  }],
  outputSourceHandlers: [{ id: 'node.merge.output-source', canResolve: nodeId => nodeId.startsWith('merge:'), resolve: materializeMergeOutputSource }],
  previewHandlers: [{
    id: 'node.merge.preview', canPreview: nodeId => nodeId.startsWith('merge:'),
    preview: (nodeId, context) => {
      try {
        const { source, headers, indices } = resolveMergeInput(context, nodeId)
        const outputId = materializeMergeOutputSource(nodeId, context)
        if (!outputId) throw new Error('Extract a text or ID field from objects before merging.')
        context.openPairedSourcePreview({
          ...source, id: `${nodeId}:input-preview`, name: 'merge inputs', headers,
          rows: source.rows.map(row => indices.map(index => row[index])),
        }, outputId ? context.dataStore.findById(outputId) ?? null : null)
      } catch (error) {
        context.toast.add({ severity: 'warn', summary: 'Merge incomplete', detail: error instanceof Error ? error.message : String(error), life: 4000 })
      }
    },
  }],
  connectionHandlers: [{
    id: 'node.merge.connections',
    canHandleConnection: connection => Boolean(connection.target?.startsWith('merge:') || (connection.source?.startsWith('merge:') && connection.target?.startsWith('shape:'))),
    connect: (connection, context) => {
      const sourceHandle = connection.sourceHandle ?? ''
      const targetHandle = connection.targetHandle ?? ''
      if (connection.source && /^(src:|geonames:|merge:|split:|hash:)/.test(connection.source) && connection.target?.startsWith('merge:')) {
        const node = context.mappingStore.findExtensionNode<MergeNodeConfig>(MERGE_NODE_STATE_KEY, connection.target)
        const inputNumber = Number(targetHandle.replace('merge-input-', ''))
        if (!node || !sourceHandle.startsWith('h:') || !/^merge-input-[1-9]\d*$/.test(targetHandle) || inputNumber > node.inputCount) return false
        if (wouldCreateGeoNamesMergeCycle(connection.source, node.id, context.mappingStore)) {
          context.toast.add({ severity: 'warn', summary: 'Connection would create a cycle', detail: 'A node cannot receive its own output through other nodes.', life: 4000 })
          return true
        }
        const otherInputs = getMergeInputs(context.mappingStore, node.id).filter(edge => edge.targetHandle !== targetHandle)
        if (otherInputs.some(edge => edge.source !== connection.source)) {
          context.toast.add({ severity: 'warn', summary: 'Merge input invalid', detail: 'Merge inputs must come from the same source table or the same GeoNames node.', life: 4000 })
          return true
        }
        context.mappingStore.upsertExtensionUiEdge(MERGE_UI_EDGE_STATE_KEY, {
          id: `merge-ui:${node.id}:${targetHandle}`, source: connection.source, sourceHandle, target: node.id, targetHandle,
        })
        syncMergeShapeMappings(node.id, context)
        return true
      }
      if (connection.source?.startsWith('merge:') && connection.target?.startsWith('shape:')) {
        if (sourceHandle !== `h:${MERGE_OUTPUT_HEADER}` || !targetHandle.startsWith('p:')) return false
        context.mappingStore.upsertExtensionUiEdge(MERGE_UI_EDGE_STATE_KEY, {
          id: `merge-ui:${connection.source}:${sourceHandle}->${connection.target}:${targetHandle}`,
          source: connection.source, sourceHandle, target: connection.target, targetHandle,
        })
        syncMergeShapeMappings(connection.source, context)
        return true
      }
      return false
    },
    deleteUiEdge: (edgeId, context) => {
      if (!edgeId.startsWith('merge-ui:')) return false
      const { removed } = context.mappingStore.removeExtensionUiEdge<MergeUiEdge>(MERGE_UI_EDGE_STATE_KEY, edgeId)
      if (removed) syncMergeShapeMappings(removed.target.startsWith('merge:') ? removed.target : removed.source, context)
      return true
    },
    deleteMappingEdge: (edge, shapeIri, propertyPath, context) => {
      const nodeId = mappingEnrichmentNodeId(edge, 'merge')
      if (!nodeId) return false
      const uiEdge = getMergeUiEdges(context.mappingStore).find(candidate => candidate.source === nodeId && candidate.target === `shape:${shapeIri}` && candidate.targetHandle === `p:${propertyPath}`)
      if (uiEdge) context.mappingStore.removeExtensionUiEdge(MERGE_UI_EDGE_STATE_KEY, uiEdge.id)
      syncMergeShapeMappings(nodeId, context)
      return true
    },
  }],
  snapshotHandlers: [createNodeSnapshotHandler<MergeNodeConfig, MergeUiEdge>({
    id: 'node.merge', nodeStateKey: MERGE_NODE_STATE_KEY, uiEdgeStateKey: MERGE_UI_EDGE_STATE_KEY, cloneNode: node => ({ ...node }),
  })],
})
