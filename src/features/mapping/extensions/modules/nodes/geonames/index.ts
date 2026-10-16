import { CANVAS_EDGE_STYLES } from '@/features/mapping/canvasTheme'
import { defineAsyncComponent, markRaw } from 'vue'
import { mappingEnrichmentNodeId } from '@/domain/Mapping'
import { createMappingExtensionModule } from '@/features/mapping/extensions/core/createMappingExtensionModule'
import {
  createNodeSnapshotHandler,
  getExtensionNodes,
} from '@/features/mapping/extensions/core/stateHelpers'
import type { ExtensionCanvasBuildContext, MappingExtensionSnapshotContext } from '@/features/mapping/extensions/core/types'
import type { GeoNamesNodeConfig, GeoNamesUiEdge } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import { GEONAMES_INPUT_OPTIONS, geoNamesInputOption, isGeoNamesCoordinateInput, normalizeGeoNamesInputType } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import { wouldCreateGeoNamesMergeCycle } from '@/features/mapping/extensions/modules/nodes/merge/workflow'
import {
  GEONAMES_NODE_STATE_KEY,
  GEONAMES_UI_EDGE_STATE_KEY,
  getGeoNamesNode,
  getGeoNamesInputMode,
  getGeoNamesInputEdges,
  getGeoNamesUiEdges,
  materializeGeoNamesOutputSource,
  runGeoNamesNode,
  syncGeoNamesShapeMappings,
  updateGeoNamesNode,
} from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
const GeoNamesEnrichmentPanel = defineAsyncComponent(() => import('@/features/mapping/components/setup/GeoNamesEnrichmentPanel.vue'))
const EnrichNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/EnrichNode.vue'))

const outputLabelById = new Map<string, string>([
  ['name', 'Name'],
  ['id', 'GeoNames ID'],
  ['lat', 'Latitude'],
  ['lng', 'Longitude'],
  ['countryName', 'Country name'],
  ['countryCode', 'Country code'],
  ['featureClass', 'Feature class'],
  ['featureCode', 'Feature code'],
  ['population', 'Population'],
  ['wikipediaURL', 'Wikipedia URL'],
] as const)

function getGeoNamesNodes(context: ExtensionCanvasBuildContext | MappingExtensionSnapshotContext): GeoNamesNodeConfig[] {
  return getExtensionNodes<GeoNamesNodeConfig>(context, GEONAMES_NODE_STATE_KEY)
}

function getCanvasGeoNamesUiEdges(context: ExtensionCanvasBuildContext | MappingExtensionSnapshotContext): GeoNamesUiEdge[] {
  return getGeoNamesUiEdges(context.mappingStore)
}

function cloneGeoNamesNode(node: GeoNamesNodeConfig): GeoNamesNodeConfig {
  return {
    ...node,
    inputMode: node.inputMode ? normalizeGeoNamesInputType(node.inputMode) : undefined,
    inputType: node.inputType ? normalizeGeoNamesInputType(node.inputType) : undefined,
    selectedOutputs: [...node.selectedOutputs],
    stats: { ...node.stats },
    lookupErrors: node.lookupErrors?.map(error => ({ ...error })),
    results: Object.fromEntries(Object.entries(node.results).map(([key, value]) => [key, { ...value }])),
  }
}

export const geoNamesModule = createMappingExtensionModule({
  id: 'node.geonames',
  setupDialogs: [
    {
      id: 'geonames-enrichment',
      header: 'GeoNames Enrichment',
      width: '720px',
      component: GeoNamesEnrichmentPanel,
      buildProps: payload => ({
        nodeId: payload?.nodeId,
      }),
    },
  ],
  mappingNodeActions: [
    {
      id: 'geonames',
      label: 'GeoNames',
      icon: 'pi pi-map-marker',
      category: 'enrichment',
      dialogId: 'geonames-enrichment',
    },
  ],
  canvasNodeTypes: {
    enrichNode: markRaw(EnrichNode),
  },
  mappingEdgeSourceHandlers: [
    {
      id: 'node.geonames.mapping-edge-source',
      canResolve: edge => Boolean(mappingEnrichmentNodeId(edge, 'geonames')),
      resolve: edge => ({ source: mappingEnrichmentNodeId(edge, 'geonames')! }),
    },
  ],
  canvasModules: [
    {
      id: 'geonames',
      buildNodes: context => getGeoNamesNodes(context).map(node => {
        const inputMode = getGeoNamesInputMode(context.mappingStore, node.id)
        const option = geoNamesInputOption(inputMode)
        return {
          id: node.id,
          type: 'enrichNode',
          position: { x: 0, y: 0 },
          data: {
            title: 'GeoNames',
            subtitle: node.username,
            icon: 'pi pi-map-marker',
            inputHandleId: 'geo-input',
            inputLabel: option.description,
            inputs: option.inputs.map(input => ({ id: input.id, label: input.label })),
            inputMode,
            inputModeOptions: GEONAMES_INPUT_OPTIONS.map(mode => ({ id: mode.inputType, label: mode.label })),
            onInputModeChange: (value: string) => {
              const selected = GEONAMES_INPUT_OPTIONS.find(mode => mode.inputType === value)
              if (selected && node.status !== 'running') {
                updateGeoNamesNode(context.mappingStore, context.dataStore, node.id, { inputMode: selected.inputType })
              }
            },
            status: node.status,
            processedCount: node.stats.processedCount,
            totalCount: node.stats.totalCount,
            cachedCount: node.stats.cachedCount,
            outputs: node.selectedOutputs.map(output => ({
              id: `h:${output}`,
              label: outputLabelById.get(output) ?? output,
            })),
            actionLabel: node.stats.totalCount > 0 ? 'Refresh' : 'Run',
            footerNote: 'Connect the required inputs',
            lastError: node.stats.lastError,
            lookupErrors: node.lookupErrors,
            onOpenConfig: () => context.openSetupDialog('geonames-enrichment', { nodeId: node.id }),
            onPreview: () => context.openNodePreview(node.id),
            onDelete: () => context.deleteNode(node.id),
            onRun: () => context.runNode(node.id),
          },
        }
      }),
      buildEdges: context => getCanvasGeoNamesUiEdges(context)
        .filter(edge => !edge.target.startsWith('shape:'))
        .map(edge => ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: edge.targetHandle,
          animated: false,
          style: CANVAS_EDGE_STYLES.primaryDashed,
        })),
    },
  ],
  defaultNodePositions: {
    enrichNode: { x: 620, y: 40 },
  },
  previewHandlers: [
    {
      id: 'node.geonames.preview',
      canPreview: nodeId => nodeId.startsWith('geonames:'),
      preview: (nodeId, context) => {
        const node = getGeoNamesNode(context.mappingStore, nodeId)
        const outputSourceId = materializeGeoNamesOutputSource(context.mappingStore, context.dataStore, nodeId, context.sources)
        if (!node || !outputSourceId) {
          context.toast.add({
            severity: 'info',
            summary: 'No GeoNames output yet',
            detail: 'Run the GeoNames node first to inspect the fetched output.',
            life: 3500,
          })
          return
        }

        const source = context.dataStore.findById(outputSourceId)
        if (!source) {
          context.toast.add({
            severity: 'warn',
            summary: 'GeoNames output unavailable',
            detail: 'Run the GeoNames node again to rebuild the output preview.',
            life: 4000,
          })
          return
        }

        context.openTablePreview(source)
      },
    },
  ],
  outputSourceHandlers: [
    {
      id: 'node.geonames.output-source',
      canResolve: nodeId => nodeId.startsWith('geonames:'),
      resolve: (nodeId, context) =>
        materializeGeoNamesOutputSource(context.mappingStore, context.dataStore, nodeId, context.sources),
    },
  ],
  runtimeHandlers: [
    {
      id: 'node.geonames.runtime',
      canRun: nodeId => nodeId.startsWith('geonames:'),
      errorSummary: 'GeoNames failed',
      run: async (nodeId, context) => {
        await runGeoNamesNode(context.mappingStore, context.dataStore, nodeId, context.sources)
        const node = getGeoNamesNode(context.mappingStore, nodeId)
        const failedCount = node?.lookupErrors?.length ?? 0
        return {
          successSeverity: failedCount > 0 ? 'warn' : 'success',
          successSummary: failedCount > 0 ? 'GeoNames completed with warnings' : 'GeoNames processed',
          successDetail: node
            ? `${node.stats.processedCount}/${node.stats.totalCount} values processed, ${node.stats.cachedCount} from cache.${failedCount > 0 ? ` ${failedCount} lookup(s) failed; their output is empty. See the node for details.` : ''}`
            : 'GeoNames enrichment completed.',
        }
      },
    },
  ],
  connectionHandlers: [
    {
      id: 'node.geonames.connections',
      canHandleConnection: connection => (
        ((connection.source?.startsWith('src:') || connection.source?.startsWith('merge:') || connection.source?.startsWith('split:') || connection.source?.startsWith('hash:')) && connection.target?.startsWith('geonames:'))
        || (connection.source?.startsWith('geonames:') && connection.target?.startsWith('shape:'))
      ),
      connect: (connection, context) => {
        const sourceHandle = connection.sourceHandle ?? ''
        const targetHandle = connection.targetHandle ?? ''

        if ((connection.source?.startsWith('src:') || connection.source?.startsWith('merge:') || connection.source?.startsWith('split:') || connection.source?.startsWith('hash:')) && connection.target?.startsWith('geonames:')) {
          const node = getGeoNamesNode(context.mappingStore, connection.target)
          if (!node || node.status === 'running') return false
          const inputMode = getGeoNamesInputMode(context.mappingStore, node.id)
          const ports = geoNamesInputOption(inputMode).inputs
          if (!sourceHandle.startsWith('h:') || !ports.some(input => input.id === targetHandle)) return false
          if (!connection.source.startsWith('src:') && wouldCreateGeoNamesMergeCycle(connection.source, node.id, context.mappingStore)) {
            context.toast.add({ severity: 'warn', summary: 'Connection would create a cycle', detail: 'A transformation cannot feed a GeoNames node that supplies its own inputs.', life: 4000 })
            return true
          }
          if (isGeoNamesCoordinateInput(inputMode)
            && getGeoNamesInputEdges(context.mappingStore, node.id).some(edge => edge.targetHandle !== targetHandle && edge.source !== connection.source)) {
            context.toast.add({
              severity: 'warn', summary: 'GeoNames input invalid',
              detail: 'Latitude and longitude must come from the same source table.', life: 4000,
            })
            return true
          }
          context.mappingStore.setExtensionState(GEONAMES_UI_EDGE_STATE_KEY,
            getGeoNamesUiEdges(context.mappingStore).filter(edge =>
              edge.target !== connection.target || ports.some(input => input.id === edge.targetHandle),
            ),
          )
          context.mappingStore.upsertExtensionUiEdge(GEONAMES_UI_EDGE_STATE_KEY, {
            id: `geo-ui:${connection.target}:${isGeoNamesCoordinateInput(inputMode) ? targetHandle : 'input'}`,
            source: connection.source,
            sourceHandle,
            target: connection.target,
            targetHandle,
          })
          return true
        }

        if (connection.source?.startsWith('geonames:') && connection.target?.startsWith('shape:')) {
          if (!sourceHandle.startsWith('h:') || !targetHandle.startsWith('p:')) return false
          context.mappingStore.upsertExtensionUiEdge(GEONAMES_UI_EDGE_STATE_KEY, {
            id: `geo-ui:${connection.source}:${sourceHandle}->${connection.target}:${targetHandle}`,
            source: connection.source,
            sourceHandle,
            target: connection.target,
            targetHandle,
          })
          syncGeoNamesShapeMappings(context.mappingStore, context.dataStore, connection.source, context.sources)
          return true
        }

        return false
      },
      deleteUiEdge: (edgeId, context) => {
        if (!edgeId.startsWith('geo-ui:')) return false
        const { removed } = context.mappingStore.removeExtensionUiEdge(GEONAMES_UI_EDGE_STATE_KEY, edgeId)
        if (removed?.source.startsWith('geonames:') && removed.target.startsWith('shape:')) {
          syncGeoNamesShapeMappings(context.mappingStore, context.dataStore, removed.source, context.sources)
        }
        return true
      },
      deleteMappingEdge: (edge, shapeIri, propertyPath, context) => {
        const nodeId = mappingEnrichmentNodeId(edge, 'geonames')
        if (!nodeId) return false
        const uiEdge = getGeoNamesUiEdges(context.mappingStore).find(candidate =>
          candidate.source === nodeId
          && candidate.sourceHandle === `h:${edge.sourceHeader}`
          && candidate.target === `shape:${shapeIri}`
          && candidate.targetHandle === `p:${propertyPath}`,
        )
        if (!uiEdge) return false
        context.mappingStore.removeExtensionUiEdge(GEONAMES_UI_EDGE_STATE_KEY, uiEdge.id)
        syncGeoNamesShapeMappings(context.mappingStore, context.dataStore, nodeId, context.sources)
        return true
      },
    },
  ],
  snapshotHandlers: [
    createNodeSnapshotHandler<GeoNamesNodeConfig, GeoNamesUiEdge>({
      id: 'node.geonames',
      nodeStateKey: GEONAMES_NODE_STATE_KEY,
      uiEdgeStateKey: GEONAMES_UI_EDGE_STATE_KEY,
      cloneNode: cloneGeoNamesNode,
    }),
  ],
})


