import { defineAsyncComponent, markRaw } from 'vue'
import { mappingEnrichmentNodeId } from '@/domain/Mapping'
import { CANVAS_EDGE_STYLES } from '@/features/mapping/canvasTheme'
import { createMappingExtensionModule } from '@/features/mapping/extensions/core/createMappingExtensionModule'
import { createNodeSnapshotHandler, getExtensionNodes } from '@/features/mapping/extensions/core/stateHelpers'
import { wouldCreateTextCycle } from '@/features/mapping/extensions/core/textTransformGraph'
import type { HashNodeConfig, HashUiEdge } from './types'
import { createHashNode, getHashUiEdges, materializeHashOutputSource, resolveHashInput, syncHashShapeMappings, HASH_NODE_STATE_KEY, HASH_UI_EDGE_STATE_KEY, HASH_OUTPUT_HEADER } from './workflow'

const TransformNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/TransformNode.vue'))

export const hashModule = createMappingExtensionModule({
  id: 'node.hash',
  mappingNodeActions: [{ id: 'hash', label: 'HASH', icon: 'pi pi-hashtag', category: 'transformation', createNode: createHashNode }],
  canvasNodeTypes: { hashNode: markRaw(TransformNode) },
  defaultNodePositions: { hashNode: { x: 620, y: 40 } },
  canvasModules: [{
    id: 'hash',
    buildNodes: context => getExtensionNodes<HashNodeConfig>(context, HASH_NODE_STATE_KEY).map(node => {
      const input = getHashUiEdges(context.mappingStore).find(edge => edge.target === node.id)
      return {
        id: node.id, type: 'hashNode', position: { x: 0, y: 0 }, data: {
          title: 'HASH', subtitle: 'SHA-256 identifier', icon: 'pi pi-hashtag',
          inputs: [{ id: 'hash-input', label: 'Input', state: input ? 'connected' : 'pending', stateLabel: input?.sourceHandle.slice(2) ?? 'pending' }],
          outputs: [{ id: `h:${HASH_OUTPUT_HEADER}`, label: 'Hash' }],
          note: 'Same text produces the same hash. Surrounding whitespace is trimmed; case is preserved. Empty inputs stay empty. Arrays are hashed per value.',
          onPreview: () => context.openNodePreview(node.id), onDelete: () => context.deleteNode(node.id),
        },
      }
    }),
    buildEdges: context => getHashUiEdges(context.mappingStore).filter(edge => !edge.target.startsWith('shape:')).map(edge => ({ ...edge, animated: false, style: CANVAS_EDGE_STYLES.primaryDashed })),
  }],
  mappingEdgeSourceHandlers: [{
    id: 'node.hash.mapping-edge-source', canResolve: edge => Boolean(mappingEnrichmentNodeId(edge, 'hash')),
    resolve: edge => ({ source: mappingEnrichmentNodeId(edge, 'hash')!, sourceHandle: `h:${HASH_OUTPUT_HEADER}` }),
  }],
  outputSourceHandlers: [{ id: 'node.hash.output-source', canResolve: id => id.startsWith('hash:'), resolve: materializeHashOutputSource }],
  previewHandlers: [{
    id: 'node.hash.preview', canPreview: id => id.startsWith('hash:'), preview: (id, context) => {
      try {
        const { source, header, index } = resolveHashInput(context, id)
        const outputId = materializeHashOutputSource(id, context)
        if (!outputId) throw new Error('Extract a text or ID field from objects before hashing.')
        context.openPairedSourcePreview({ ...source, id: `${id}:input-preview`, name: 'HASH input', headers: [header], rows: source.rows.map(row => [row[index]]) }, context.dataStore.findById(outputId) ?? null)
      } catch (error) {
        context.toast.add({ severity: 'warn', summary: 'HASH incomplete', detail: error instanceof Error ? error.message : String(error), life: 4000 })
      }
    },
  }],
  connectionHandlers: [{
    id: 'node.hash.connections',
    canHandleConnection: connection => Boolean(connection.target?.startsWith('hash:') || (connection.source?.startsWith('hash:') && connection.target?.startsWith('shape:'))),
    connect: (connection, context) => {
      const sourceHandle = connection.sourceHandle ?? ''
      const targetHandle = connection.targetHandle ?? ''
      if (!sourceHandle.startsWith('h:') || !connection.source || !connection.target) return false
      if (/^(src:|geonames:|merge:|split:|hash:)/.test(connection.source) && connection.target.startsWith('hash:')) {
        if (targetHandle !== 'hash-input' || !context.mappingStore.findExtensionNode(HASH_NODE_STATE_KEY, connection.target)) return false
        if (wouldCreateTextCycle(connection.source, connection.target, context.mappingStore)) {
          context.toast.add({ severity: 'warn', summary: 'Connection would create a cycle', life: 4000 })
          return true
        }
        context.mappingStore.upsertExtensionUiEdge(HASH_UI_EDGE_STATE_KEY, { id: `hash-ui:${connection.target}:input`, source: connection.source, sourceHandle, target: connection.target, targetHandle })
        syncHashShapeMappings(connection.target, context)
        return true
      }
      if (connection.source.startsWith('hash:') && connection.target.startsWith('shape:')) {
        if (!context.mappingStore.findExtensionNode(HASH_NODE_STATE_KEY, connection.source) || sourceHandle !== `h:${HASH_OUTPUT_HEADER}` || !targetHandle.startsWith('p:')) return false
        context.mappingStore.upsertExtensionUiEdge(HASH_UI_EDGE_STATE_KEY, { id: `hash-ui:${connection.source}:${sourceHandle}->${connection.target}:${targetHandle}`, source: connection.source, sourceHandle, target: connection.target, targetHandle })
        syncHashShapeMappings(connection.source, context)
        return true
      }
      return false
    },
    deleteUiEdge: (id, context) => {
      if (!id.startsWith('hash-ui:')) return false
      const { removed } = context.mappingStore.removeExtensionUiEdge(HASH_UI_EDGE_STATE_KEY, id)
      if (removed) syncHashShapeMappings(removed.target.startsWith('hash:') ? removed.target : removed.source, context)
      return true
    },
    deleteMappingEdge: (edge, shapeIri, propertyPath, context) => {
      const id = mappingEnrichmentNodeId(edge, 'hash')
      if (!id) return false
      const connection = getHashUiEdges(context.mappingStore).find(item => item.source === id && item.target === `shape:${shapeIri}` && item.targetHandle === `p:${propertyPath}`)
      if (!connection) return false
      context.mappingStore.removeExtensionUiEdge(HASH_UI_EDGE_STATE_KEY, connection.id)
      syncHashShapeMappings(id, context)
      return true
    },
  }],
  snapshotHandlers: [createNodeSnapshotHandler<HashNodeConfig, HashUiEdge>({ id: 'node.hash', nodeStateKey: HASH_NODE_STATE_KEY, uiEdgeStateKey: HASH_UI_EDGE_STATE_KEY, cloneNode: node => ({ ...node }) })],
})
