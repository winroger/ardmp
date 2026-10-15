import { createEnrichmentMappingEdge, mappingEnrichmentNodeId } from '@/domain/Mapping'
import type { MappingNodeOutputSourceContext, MappingExtensionStoreApi } from '@/features/mapping/extensions/core/types'
import type { MergeNodeConfig, MergeUiEdge } from './types'
import { alignedRecordIdsForSource } from '@/services/mapping/enrichmentRuntime'
import { mergeText } from '@/services/mapping/textValues'
import { materializeTextNode, syncDependentTextTransforms, textInputSource, wouldCreateTextCycle, type TextTransformContext } from '@/features/mapping/extensions/core/textTransformGraph'

export const MERGE_NODE_STATE_KEY = 'node.merge.nodes'
export const MERGE_UI_EDGE_STATE_KEY = 'node.merge.uiEdges'
export const MERGE_OUTPUT_HEADER = 'merged'

type MergeOutputContext = TextTransformContext

export function createMergeNode(mappingStore: MappingExtensionStoreApi): MergeNodeConfig {
  return mappingStore.createExtensionNode(MERGE_NODE_STATE_KEY, 'merge', id => ({ id, inputCount: 2, separator: ', ' }))
}

export function getMergeUiEdges(mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): MergeUiEdge[] {
  return mappingStore.getExtensionState(MERGE_UI_EDGE_STATE_KEY, [] as MergeUiEdge[])
}

export function getMergeInputs(mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>, nodeId: string): MergeUiEdge[] {
  return getMergeUiEdges(mappingStore)
    .filter(edge => edge.target === nodeId && /^merge-input-\d+$/.test(edge.targetHandle))
    .sort((a, b) => Number(a.targetHandle.slice(12)) - Number(b.targetHandle.slice(12)))
}

export function mergeValues(values: unknown[], separator = ', '): string {
  return mergeText(values, separator)
}

export function resolveMergeInput(context: MergeOutputContext, nodeId: string) {
  const node = context.mappingStore.findExtensionNode<MergeNodeConfig>(MERGE_NODE_STATE_KEY, nodeId)
  if (!node) throw new Error('Merge node not found.')
  const inputs = getMergeInputs(context.mappingStore, nodeId)
  if (inputs.length < 2) throw new Error('Connect at least two fields to merge.')
  if (inputs.some(input => input.source !== inputs[0]!.source)) {
    throw new Error('Merge inputs must come from the same source table.')
  }
  const source = textInputSource(inputs[0]!.source, context)
  const headers = inputs.map(input => input.sourceHandle.slice(2))
  const indices = headers.map(header => source.headers.indexOf(header))
  if (indices.some(index => index < 0)) throw new Error('A connected source column is no longer available.')
  return { source, headers, indices, separator: node.separator ?? ', ' }
}

export function materializeMergeOutputSource(nodeId: string, context: MergeOutputContext): string | undefined {
  try {
    return materializeTextNode(nodeId, () => {
      const { source, indices, separator } = resolveMergeInput(context, nodeId)
      return context.dataStore.addNodeOutputSource('merge', nodeId, [MERGE_OUTPUT_HEADER],
        source.rows.map(row => [mergeValues(indices.map(index => row[index]), separator)]), alignedRecordIdsForSource(source), source.id)
    })
  } catch {
    context.dataStore.removeNodeOutputSources(nodeId)
    return undefined
  }
}

export function syncMergeShapeMappings(nodeId: string, context: MergeOutputContext): void {
  const sourceId = materializeMergeOutputSource(nodeId, context)
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'merge') !== nodeId)
  if (sourceId) for (const edge of getMergeUiEdges(context.mappingStore)) {
    if (edge.source !== nodeId || !edge.target.startsWith('shape:')) continue
    context.mappingStore.state.addOrReplace(createEnrichmentMappingEdge({
      sourceId, sourceHeader: MERGE_OUTPUT_HEADER, shapeIri: edge.target.slice(6), propertyPath: edge.targetHandle.slice(2),
    }, { provider: 'merge', nodeId }))
  }
  syncDependentTextTransforms(nodeId, context)
}

export function syncDependentMergeMappings(upstreamNodeId: string, context: MergeOutputContext, outputs?: readonly string[]): void {
  syncDependentTextTransforms(upstreamNodeId, context, outputs)
}

export function removeMergeInputsFromNode(upstreamNodeId: string, context: MergeOutputContext): void {
  syncDependentMergeMappings(upstreamNodeId, context, [])
}

export function wouldCreateGeoNamesMergeCycle(source: string, target: string, mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): boolean {
  return wouldCreateTextCycle(source, target, mappingStore)
}

export function deleteMergeNode(nodeId: string, context: MappingNodeOutputSourceContext): void {
  context.mappingStore.removeExtensionNode(MERGE_NODE_STATE_KEY, nodeId)
  context.dataStore.removeNodeOutputSources(nodeId)
  syncDependentTextTransforms(nodeId, context, [])
  context.mappingStore.setExtensionState(MERGE_UI_EDGE_STATE_KEY,
    getMergeUiEdges(context.mappingStore).filter(edge => edge.source !== nodeId && edge.target !== nodeId))
  const geoEdges = context.mappingStore.getExtensionState('node.geonames.uiEdges', [] as MergeUiEdge[])
  context.mappingStore.setExtensionState('node.geonames.uiEdges', geoEdges.filter(edge => edge.source !== nodeId))
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'merge') !== nodeId)
}
