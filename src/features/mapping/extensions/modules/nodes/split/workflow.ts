import { createEnrichmentMappingEdge, mappingEnrichmentNodeId } from '@/domain/Mapping'
import type { MappingExtensionStoreApi } from '@/features/mapping/extensions/core/types'
import { alignedRecordIdsForSource } from '@/services/mapping/enrichmentRuntime'
import { scalarText } from '@/services/mapping/textValues'
import { materializeTextNode, syncDependentTextTransforms, textInputSource, type TextTransformContext } from '@/features/mapping/extensions/core/textTransformGraph'
import type { SplitMode, SplitNodeConfig, SplitUiEdge } from './types'

export const SPLIT_NODE_STATE_KEY = 'node.split.nodes'
export const SPLIT_UI_EDGE_STATE_KEY = 'node.split.uiEdges'

export function createSplitNode(mappingStore: MappingExtensionStoreApi): SplitNodeConfig {
  return mappingStore.createExtensionNode(SPLIT_NODE_STATE_KEY, 'split', id => ({ id, mode: 'columns', separator: ', ' }))
}

export function getSplitUiEdges(mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): SplitUiEdge[] {
  return mappingStore.getExtensionState(SPLIT_UI_EDGE_STATE_KEY, [] as SplitUiEdge[])
}

export function splitOutputHeaders(node: SplitNodeConfig): string[] {
  return node.mode === 'array' ? ['values'] : ['first', 'second']
}

export function splitValues(value: unknown, mode: SplitMode, separator: string): unknown[] {
  if (!separator) throw new Error('Enter a separator for split.')
  if (Array.isArray(value)) {
    const parts = value.map(scalarText)
    return mode === 'array' ? [parts] : [parts[0] ?? '', parts.slice(1).join(separator)]
  }
  if (value != null && typeof value === 'object') scalarText(value)
  const raw = String(value ?? '')
  if (mode === 'array') return [raw.trim() ? raw.split(separator).map(part => part.trim()) : []]
  const index = raw.indexOf(separator)
  return index < 0 ? [raw.trim(), ''] : [raw.slice(0, index).trim(), raw.slice(index + separator.length).trim()]
}

export function resolveSplitInput(context: TextTransformContext, nodeId: string) {
  const node = context.mappingStore.findExtensionNode<SplitNodeConfig>(SPLIT_NODE_STATE_KEY, nodeId)
  if (!node) throw new Error('Split node not found.')
  if (!node.separator) throw new Error('Enter a separator for split.')
  const input = getSplitUiEdges(context.mappingStore).find(edge => edge.target === nodeId && edge.targetHandle === 'split-input')
  if (!input) throw new Error('Connect a field to split.')
  const source = textInputSource(input.source, context)
  const header = input.sourceHandle.slice(2)
  const index = source.headers.indexOf(header)
  if (index < 0) throw new Error('The connected source column is no longer available.')
  return { node, source, header, index }
}

export function materializeSplitOutputSource(nodeId: string, context: TextTransformContext): string | undefined {
  try {
    return materializeTextNode(nodeId, () => {
      const { node, source, index } = resolveSplitInput(context, nodeId)
      return context.dataStore.addNodeOutputSource('split', nodeId, splitOutputHeaders(node),
        source.rows.map(row => splitValues(row[index], node.mode, node.separator)), alignedRecordIdsForSource(source), source.id)
    })
  } catch {
    context.dataStore.removeNodeOutputSources(nodeId)
    return undefined
  }
}

export function syncSplitShapeMappings(nodeId: string, context: TextTransformContext): void {
  const sourceId = materializeSplitOutputSource(nodeId, context)
  const node = context.mappingStore.findExtensionNode<SplitNodeConfig>(SPLIT_NODE_STATE_KEY, nodeId)
  const headers = node ? splitOutputHeaders(node) : []
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'split') !== nodeId)
  if (sourceId) for (const edge of getSplitUiEdges(context.mappingStore)) {
    const sourceHeader = edge.sourceHandle.slice(2)
    if (edge.source !== nodeId || !edge.target.startsWith('shape:') || !headers.includes(sourceHeader)) continue
    context.mappingStore.state.addOrReplace(createEnrichmentMappingEdge({
      sourceId, sourceHeader, shapeIri: edge.target.slice(6), propertyPath: edge.targetHandle.slice(2),
    }, { provider: 'split', nodeId }))
  }
  syncDependentTextTransforms(nodeId, context, headers)
}

export function updateSplitNode(nodeId: string, patch: Partial<Pick<SplitNodeConfig, 'mode' | 'separator'>>, context: TextTransformContext & { mappingStore: MappingExtensionStoreApi }): void {
  context.mappingStore.updateExtensionNode<SplitNodeConfig>(SPLIT_NODE_STATE_KEY, nodeId, node => ({ ...node, ...patch }))
  const node = context.mappingStore.findExtensionNode<SplitNodeConfig>(SPLIT_NODE_STATE_KEY, nodeId)
  if (node) context.mappingStore.setExtensionState(SPLIT_UI_EDGE_STATE_KEY,
    getSplitUiEdges(context.mappingStore).filter(edge => edge.source !== nodeId || splitOutputHeaders(node).includes(edge.sourceHandle.slice(2))))
  syncSplitShapeMappings(nodeId, context)
}

export function deleteSplitNode(nodeId: string, context: TextTransformContext & { mappingStore: MappingExtensionStoreApi }): void {
  context.mappingStore.removeExtensionNode(SPLIT_NODE_STATE_KEY, nodeId)
  context.dataStore.removeNodeOutputSources(nodeId)
  syncDependentTextTransforms(nodeId, context, [])
  context.mappingStore.setExtensionState(SPLIT_UI_EDGE_STATE_KEY, getSplitUiEdges(context.mappingStore).filter(edge => edge.source !== nodeId && edge.target !== nodeId))
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'split') !== nodeId)
}
