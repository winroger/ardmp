import { createEnrichmentMappingEdge, mappingEnrichmentNodeId } from '@/domain/Mapping'
import type { MappingNodeOutputSourceContext, MappingExtensionStoreApi } from '@/features/mapping/extensions/core/types'
import type { MergeNodeConfig, MergeUiEdge } from './types'
import type { GeoNamesNodeConfig } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import { alignedRecordIdsForSource } from '@/services/mapping/enrichmentRuntime'
import type { DataSource } from '@/domain/DataSource'

export const MERGE_NODE_STATE_KEY = 'node.merge.nodes'
export const MERGE_UI_EDGE_STATE_KEY = 'node.merge.uiEdges'
export const MERGE_OUTPUT_HEADER = 'merged'

type MergeOutputContext = Pick<MappingNodeOutputSourceContext, 'dataStore' | 'sources'> & {
  mappingStore: Pick<MappingExtensionStoreApi, 'findExtensionNode' | 'getExtensionState' | 'setExtensionState' | 'state'>
}

export function createMergeNode(mappingStore: MappingExtensionStoreApi): MergeNodeConfig {
  return mappingStore.createExtensionNode(MERGE_NODE_STATE_KEY, 'merge', id => ({ id, inputCount: 2 }))
}

export function getMergeUiEdges(mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): MergeUiEdge[] {
  return mappingStore.getExtensionState(MERGE_UI_EDGE_STATE_KEY, [] as MergeUiEdge[])
}

export function getMergeInputs(mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>, nodeId: string): MergeUiEdge[] {
  return getMergeUiEdges(mappingStore)
    .filter(edge => edge.target === nodeId && /^merge-input-\d+$/.test(edge.targetHandle))
    .sort((a, b) => Number(a.targetHandle.slice(12)) - Number(b.targetHandle.slice(12)))
}

export function mergeValues(values: unknown[]): string {
  return values.map(value => String(value ?? '').trim()).filter(Boolean).join(', ')
}

export function resolveMergeInput(context: MergeOutputContext, nodeId: string) {
  const node = context.mappingStore.findExtensionNode<MergeNodeConfig>(MERGE_NODE_STATE_KEY, nodeId)
  if (!node) throw new Error('Merge node not found.')
  const inputs = getMergeInputs(context.mappingStore, nodeId)
  if (inputs.length < 2) throw new Error('Connect at least two fields to merge.')
  if (inputs.some(input => input.source !== inputs[0]!.source)) {
    throw new Error('Merge inputs must come from the same source table.')
  }
  const upstream = inputs[0]!.source
  let source: DataSource | undefined
  if (upstream.startsWith('geonames:')) {
    const geoNode = context.mappingStore.findExtensionNode<GeoNamesNodeConfig>('node.geonames.nodes', upstream)
    if (!geoNode?.outputSourceId) throw new Error('Run the GeoNames node first to make its outputs available for merge.')
    source = context.dataStore.findById(geoNode.outputSourceId)
      ?? context.sources.find(candidate => candidate.id === geoNode.outputSourceId)
    if (!source) throw new Error('Run the GeoNames node first to make its outputs available for merge.')
  } else {
    const sourceId = upstream.slice(4)
    source = context.sources.find(candidate => candidate.id === sourceId) ?? context.dataStore.findById(sourceId)
  }
  if (!source) throw new Error('The connected source table is no longer available.')
  const headers = inputs.map(input => input.sourceHandle.slice(2))
  const indices = headers.map(header => source.headers.indexOf(header))
  if (indices.some(index => index < 0)) throw new Error('A connected source column is no longer available.')
  return { source, headers, indices }
}

export function materializeMergeOutputSource(nodeId: string, context: MergeOutputContext): string | undefined {
  try {
    const { source, indices } = resolveMergeInput(context, nodeId)
    return context.dataStore.addNodeOutputSource('merge', nodeId, [MERGE_OUTPUT_HEADER],
      source.rows.map(row => [mergeValues(indices.map(index => row[index]))]), alignedRecordIdsForSource(source))
  } catch {
    context.dataStore.removeNodeOutputSources(nodeId)
    return undefined
  }
}

export function syncMergeShapeMappings(nodeId: string, context: MergeOutputContext): void {
  const sourceId = materializeMergeOutputSource(nodeId, context)
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'merge') !== nodeId)
  if (!sourceId) return
  for (const edge of getMergeUiEdges(context.mappingStore)) {
    if (edge.source !== nodeId || !edge.target.startsWith('shape:')) continue
    context.mappingStore.state.addOrReplace(createEnrichmentMappingEdge({
      sourceId, sourceHeader: MERGE_OUTPUT_HEADER, shapeIri: edge.target.slice(6), propertyPath: edge.targetHandle.slice(2),
    }, { provider: 'merge', nodeId }))
  }
}

export function syncDependentMergeMappings(upstreamNodeId: string, context: MergeOutputContext, outputs?: readonly string[]): void {
  const edges = getMergeUiEdges(context.mappingStore)
  const dependentIds = new Set(edges.filter(edge => edge.source === upstreamNodeId && edge.target.startsWith('merge:')).map(edge => edge.target))
  if (outputs) {
    context.mappingStore.setExtensionState(MERGE_UI_EDGE_STATE_KEY,
      edges.filter(edge => edge.source !== upstreamNodeId || outputs.includes(edge.sourceHandle.slice(2))))
  }
  for (const nodeId of dependentIds) syncMergeShapeMappings(nodeId, context)
}

export function removeMergeInputsFromNode(upstreamNodeId: string, context: MergeOutputContext): void {
  syncDependentMergeMappings(upstreamNodeId, context, [])
}

export function wouldCreateGeoNamesMergeCycle(source: string, target: string, mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): boolean {
  const edges = [...getMergeUiEdges(mappingStore),
    ...mappingStore.getExtensionState('node.geonames.uiEdges', [] as MergeUiEdge[])]
  const pending = [target]
  const visited = new Set<string>()
  while (pending.length) {
    const nodeId = pending.pop()!
    if (nodeId === source) return true
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    pending.push(...edges.filter(edge => edge.source === nodeId).map(edge => edge.target))
  }
  return false
}

export function deleteMergeNode(nodeId: string, context: MappingNodeOutputSourceContext): void {
  context.mappingStore.removeExtensionNode(MERGE_NODE_STATE_KEY, nodeId)
  context.mappingStore.setExtensionState(MERGE_UI_EDGE_STATE_KEY,
    getMergeUiEdges(context.mappingStore).filter(edge => edge.source !== nodeId && edge.target !== nodeId))
  const geoEdges = context.mappingStore.getExtensionState('node.geonames.uiEdges', [] as MergeUiEdge[])
  context.mappingStore.setExtensionState('node.geonames.uiEdges', geoEdges.filter(edge => edge.source !== nodeId))
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'merge') !== nodeId)
  context.dataStore.removeNodeOutputSources(nodeId)
}
