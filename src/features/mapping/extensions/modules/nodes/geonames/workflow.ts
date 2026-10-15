import type { DataSource } from '@/domain/DataSource'
import type { GeoNamesNodeConfig, GeoNamesUiEdge } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import { GEONAMES_INPUT_OPTIONS, geoNamesInputOption, isGeoNamesCoordinateInput, normalizeGeoNamesInputType } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import type { TransformationUiEdge } from '@/features/mapping/extensions/modules/nodes/lat-lng-to-wkt/types'
import type { MappingExtensionStoreApi } from '@/features/mapping/extensions/core/types'
import {
  getExtensionNode,
  getExtensionUiEdges,
} from '@/features/mapping/extensions/core/stateHelpers'
import type { GeoNamesInputType, GeoNamesOutputField } from '@/features/mapping/extensions/modules/nodes/geonames/client'
import { runGeoNamesRuntime } from '@/features/mapping/extensions/modules/nodes/geonames/runtime'
import { getDependentTransformationNodeIds } from '@/services/mapping/mappingEdgeSync'
import type { useMappingStore } from '@/stores/mappingStore'
import type { useDataStore } from '@/stores/dataStore'
import { applyGeoNamesNodePatch, syncGeoNamesNodeMappings } from '@/features/mapping/extensions/modules/nodes/geonames/mapping'
import { alignedRecordIdsForSource } from '@/services/mapping/enrichmentRuntime'
import { geoNamesInputKeys, geoNamesOutputRows } from './inputs'
import { syncDependentMergeMappings } from '@/features/mapping/extensions/modules/nodes/merge/workflow'

type MappingStore = ReturnType<typeof useMappingStore>
type DataStore = ReturnType<typeof useDataStore>
type GeoNamesReadStore = Pick<MappingExtensionStoreApi, 'findExtensionNode' | 'getExtensionState'>
type GeoNamesMutationStore = GeoNamesReadStore & Pick<MappingStore, 'updateExtensionNode' | 'setExtensionState' | 'state'>
type GeoNamesRuntimeStore = MappingExtensionStoreApi & Pick<MappingStore, 'syncTransformationMappings'>

export const GEONAMES_NODE_STATE_KEY = 'node.geonames.nodes'
export const GEONAMES_UI_EDGE_STATE_KEY = 'node.geonames.uiEdges'

export function getGeoNamesNode(mappingStore: GeoNamesReadStore, nodeId: string): GeoNamesNodeConfig | undefined {
  return getExtensionNode<GeoNamesNodeConfig>(mappingStore, GEONAMES_NODE_STATE_KEY, nodeId)
}

export function getGeoNamesUiEdges(mappingStore: GeoNamesReadStore): GeoNamesUiEdge[] {
  return getExtensionUiEdges<GeoNamesUiEdge>(mappingStore, GEONAMES_UI_EDGE_STATE_KEY)
}

export function getGeoNamesInputEdge(mappingStore: GeoNamesReadStore, nodeId: string): GeoNamesUiEdge | undefined {
  return getGeoNamesInputEdges(mappingStore, nodeId)[0]
}

export function getGeoNamesInputMode(mappingStore: GeoNamesReadStore, nodeId: string): GeoNamesInputType {
  const node = getGeoNamesNode(mappingStore, nodeId)
  if (node?.inputMode) return normalizeGeoNamesInputType(node.inputMode)
  const legacyInput = getGeoNamesUiEdges(mappingStore).find(edge => edge.target === nodeId
    && ['geo-input', 'geo-text-input'].includes(edge.targetHandle))
  return legacyInput ? (legacyInput.targetHandle === 'geo-text-input' ? 'text' : 'id') : normalizeGeoNamesInputType(node?.inputType)
}

export function getGeoNamesInputEdges(mappingStore: GeoNamesReadStore, nodeId: string): GeoNamesUiEdge[] {
  const edges = getGeoNamesUiEdges(mappingStore)
  return geoNamesInputOption(getGeoNamesInputMode(mappingStore, nodeId)).inputs.flatMap(input => {
    const edge = edges.find(candidate => candidate.target === nodeId && candidate.targetHandle === input.id)
    return edge ? [edge] : []
  })
}

export function materializeGeoNamesOutputSource(
  mappingStore: GeoNamesReadStore,
  dataStore: DataStore,
  nodeId: string,
  sources: DataSource[],
): string | undefined {
  const node = getGeoNamesNode(mappingStore, nodeId)
  if (!node?.inputSourceId || !node.inputHeader) return node?.outputSourceId
  const source = sources.find(candidate => candidate.id === node.inputSourceId) ?? dataStore.findById(node.inputSourceId)
  if (!source) return node.outputSourceId
  let keys: string[]
  try {
    keys = geoNamesInputKeys(source, node.inputHeader, node.inputType ?? 'id', node.inputLongitudeHeader)
  } catch {
    return node.outputSourceId
  }
  const outputSourceId = dataStore.addNodeOutputSource('geonames', nodeId, [...node.selectedOutputs],
    geoNamesOutputRows(keys, node.results, node.selectedOutputs), alignedRecordIdsForSource(source), source.id)

  if (node.outputSourceId !== outputSourceId) {
    updateGeoNamesNode(mappingStore as GeoNamesMutationStore, dataStore, nodeId, { outputSourceId })
  }

  return outputSourceId
}

export function syncGeoNamesShapeMappings(
  mappingStore: GeoNamesMutationStore,
  dataStore: DataStore,
  nodeId: string,
  sources: DataSource[] = dataStore.sources,
): void {
  const outputSourceId = materializeGeoNamesOutputSource(mappingStore, dataStore, nodeId, sources)
  const uiEdges = getGeoNamesUiEdges(mappingStore)
  mappingStore.state.edges = syncGeoNamesNodeMappings(mappingStore.state.edges, nodeId, outputSourceId, uiEdges)
}

export function updateGeoNamesNode(
  mappingStore: GeoNamesMutationStore,
  dataStore: DataStore,
  nodeId: string,
  patch: Partial<Omit<GeoNamesNodeConfig, 'id'>>,
): void {
  const node = getGeoNamesNode(mappingStore, nodeId)
  if (!node) return
  let { nextNode, nextEdges } = applyGeoNamesNodePatch(node, patch, getGeoNamesUiEdges(mappingStore))
  const modeChanged = patch.inputMode !== undefined && patch.inputMode !== getGeoNamesInputMode(mappingStore, nodeId)
  if (modeChanged) {
    const ports = geoNamesInputOption(patch.inputMode!).inputs
    nextEdges = nextEdges.filter(edge => edge.target !== nodeId
      || !GEONAMES_INPUT_OPTIONS.some(option => option.inputs.some(input => input.id === edge.targetHandle))
      || ports.some(input => input.id === edge.targetHandle))
    nextNode = {
      ...nextNode, status: 'idle', results: {}, lookupErrors: [],
      stats: { totalCount: 0, processedCount: 0, cachedCount: 0 },
      inputSourceId: undefined, inputHeader: undefined, inputLongitudeHeader: undefined,
      inputType: undefined, outputSourceId: undefined,
    }
    dataStore.removeNodeOutputSources(nodeId)
    mappingStore.state.edges = syncGeoNamesNodeMappings(mappingStore.state.edges, nodeId, undefined, nextEdges)
      .filter(edge => edge.sourceId !== node.outputSourceId)
  }
  mappingStore.updateExtensionNode<GeoNamesNodeConfig>(GEONAMES_NODE_STATE_KEY, nodeId, () => nextNode)
  if (patch.selectedOutputs || modeChanged) {
    mappingStore.setExtensionState(GEONAMES_UI_EDGE_STATE_KEY, nextEdges)
    syncGeoNamesShapeMappings(mappingStore, dataStore, nodeId)
    syncDependentMergeMappings(nodeId, { mappingStore, dataStore, sources: dataStore.sources }, patch.selectedOutputs)
  }
}

export async function runGeoNamesNode(
  mappingStore: GeoNamesRuntimeStore,
  dataStore: DataStore,
  nodeId: string,
  sources: DataSource[],
  forceRefresh = false,
): Promise<void> {
  const node = getGeoNamesNode(mappingStore, nodeId)
  if (!node) throw new Error('GeoNames node not found.')
  const inputType = getGeoNamesInputMode(mappingStore, nodeId)
  const inputEdges = getGeoNamesInputEdges(mappingStore, nodeId)
  if (inputEdges.length !== geoNamesInputOption(inputType).inputs.length) {
    throw new Error(isGeoNamesCoordinateInput(inputType)
      ? 'Connect both latitude and longitude inputs before running GeoNames.'
      : 'Connect a source column to the selected GeoNames input first.')
  }
  const inputEdge = inputEdges[0]!
  if (inputEdges.some(edge => edge.source !== inputEdge.source)) {
    throw new Error('Latitude and longitude must come from the same source table.')
  }
  const inputLongitudeHeader = inputEdges[1]?.sourceHandle.slice(2)

  let sourceId: string | undefined
  if (inputEdge.source.startsWith('src:')) {
    sourceId = inputEdge.source.slice(4)
  } else {
    const { resolveMaterializedNodeOutputSource } = await import('@/features/mapping/mappingExtensionRegistry')
    sourceId = resolveMaterializedNodeOutputSource(inputEdge.source, { mappingStore, dataStore, sources })
  }
  if (!sourceId) throw new Error('Connect at least two fields to the merge node before running GeoNames.')
  const connectedSource = dataStore.findById(sourceId)
  const runtimeSources = !inputEdge.source.startsWith('src:') && connectedSource
    ? [...sources.filter(source => source.id !== sourceId), connectedSource]
    : sources
  const sourceHeader = inputEdge.sourceHandle.startsWith('h:') ? inputEdge.sourceHandle.slice(2) : ''

  updateGeoNamesNode(mappingStore, dataStore, nodeId, {
    status: 'running',
    lookupErrors: [],
    stats: { totalCount: 0, processedCount: 0, cachedCount: 0, lastError: undefined },
  })

  try {
    const batch = await runGeoNamesRuntime({
      nodeId,
      username: node.username,
      selectedOutputs: node.selectedOutputs,
      inputSourceId: sourceId,
      inputHeader: sourceHeader,
      inputLongitudeHeader,
      inputType,
      sources: runtimeSources,
      forceRefresh,
      onProgress: progress => {
        updateGeoNamesNode(mappingStore, dataStore, nodeId, {
          status: 'running',
          lookupErrors: progress.lookupErrors,
          stats: {
            totalCount: progress.totalCount,
            processedCount: progress.processedCount,
            cachedCount: progress.cachedCount,
          },
        })
      },
      addResultSource: (resultNodeId, headers, rows, recordIds) =>
        dataStore.addNodeOutputSource('geonames', resultNodeId, headers as GeoNamesOutputField[], rows, recordIds, sourceId),
    })

    updateGeoNamesNode(mappingStore, dataStore, nodeId, {
      inputSourceId: batch.inputSourceId,
      inputHeader: batch.inputHeader,
      inputLongitudeHeader: batch.inputLongitudeHeader,
      inputType,
      outputSourceId: batch.outputSourceId,
      status: 'success',
      results: batch.results,
      lookupErrors: batch.lookupErrors,
      stats: {
        totalCount: batch.totalCount,
        processedCount: batch.processedCount,
        cachedCount: batch.cachedCount,
        lastRunAt: new Date().toISOString(),
        lastError: undefined,
      },
    })
    syncGeoNamesShapeMappings(mappingStore, dataStore, nodeId, runtimeSources)
    syncDependentMergeMappings(nodeId, { mappingStore, dataStore, sources: runtimeSources })

    const transformationUiEdges = mappingStore.getExtensionState('node.transformation.uiEdges', [] as TransformationUiEdge[])
    for (const transformId of getDependentTransformationNodeIds(nodeId, transformationUiEdges)) {
      mappingStore.syncTransformationMappings(transformId, sources)
    }
  } catch (error) {
    updateGeoNamesNode(mappingStore, dataStore, nodeId, {
      status: 'error',
      stats: {
        ...node.stats,
        lastError: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}


