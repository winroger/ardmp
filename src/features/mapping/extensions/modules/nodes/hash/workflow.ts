import hash from 'hash.js'
import { createEnrichmentMappingEdge, mappingEnrichmentNodeId } from '@/domain/Mapping'
import type { MappingExtensionStoreApi } from '@/features/mapping/extensions/core/types'
import { alignedRecordIdsForSource } from '@/services/mapping/enrichmentRuntime'
import { scalarText } from '@/services/mapping/textValues'
import { materializeTextNode, syncDependentTextTransforms, textInputSource, type TextTransformContext } from '@/features/mapping/extensions/core/textTransformGraph'
import type { HashNodeConfig, HashUiEdge } from './types'

export const HASH_NODE_STATE_KEY = 'node.hash.nodes'
export const HASH_UI_EDGE_STATE_KEY = 'node.hash.uiEdges'
export const HASH_OUTPUT_HEADER = 'hash'

export function createHashNode(mappingStore: MappingExtensionStoreApi): HashNodeConfig {
  return mappingStore.createExtensionNode(HASH_NODE_STATE_KEY, 'hash', id => ({ id }))
}

export function getHashUiEdges(mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): HashUiEdge[] {
  return mappingStore.getExtensionState(HASH_UI_EDGE_STATE_KEY, [] as HashUiEdge[])
}

/** Hash the trimmed UTF-8 text; empty elements keep their positions. */
export function hashValue(value: unknown): string | string[] {
  const digest = (item: unknown): string => {
    const text = scalarText(item)
    return text ? hash.sha256().update(text).digest('hex') : ''
  }
  return Array.isArray(value) ? value.map(digest) : digest(value)
}

export function resolveHashInput(context: TextTransformContext, nodeId: string) {
  const node = context.mappingStore.findExtensionNode<HashNodeConfig>(HASH_NODE_STATE_KEY, nodeId)
  if (!node) throw new Error('HASH node not found.')
  const input = getHashUiEdges(context.mappingStore).find(edge => edge.target === nodeId && edge.targetHandle === 'hash-input')
  if (!input) throw new Error('Connect a field to HASH.')
  const source = textInputSource(input.source, context)
  const header = input.sourceHandle.slice(2)
  const index = source.headers.indexOf(header)
  if (index < 0) throw new Error('The connected source column is no longer available.')
  return { source, header, index }
}

export function materializeHashOutputSource(nodeId: string, context: TextTransformContext): string | undefined {
  try {
    return materializeTextNode(nodeId, () => {
      const { source, index } = resolveHashInput(context, nodeId)
      return context.dataStore.addNodeOutputSource('hash', nodeId, [HASH_OUTPUT_HEADER],
        source.rows.map(row => [hashValue(row[index])]), alignedRecordIdsForSource(source), source.id)
    })
  } catch {
    context.dataStore.removeNodeOutputSources(nodeId)
    return undefined
  }
}

export function syncHashShapeMappings(nodeId: string, context: TextTransformContext): void {
  const sourceId = materializeHashOutputSource(nodeId, context)
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'hash') !== nodeId)
  if (sourceId) for (const edge of getHashUiEdges(context.mappingStore)) {
    if (edge.source !== nodeId || !edge.target.startsWith('shape:') || edge.sourceHandle !== `h:${HASH_OUTPUT_HEADER}`) continue
    context.mappingStore.state.addOrReplace(createEnrichmentMappingEdge({
      sourceId, sourceHeader: HASH_OUTPUT_HEADER, shapeIri: edge.target.slice(6), propertyPath: edge.targetHandle.slice(2),
    }, { provider: 'hash', nodeId }))
  }
  syncDependentTextTransforms(nodeId, context)
}

export function deleteHashNode(nodeId: string, context: TextTransformContext & { mappingStore: MappingExtensionStoreApi }): void {
  context.mappingStore.removeExtensionNode(HASH_NODE_STATE_KEY, nodeId)
  context.dataStore.removeNodeOutputSources(nodeId)
  syncDependentTextTransforms(nodeId, context, [])
  context.mappingStore.setExtensionState(HASH_UI_EDGE_STATE_KEY, getHashUiEdges(context.mappingStore).filter(edge => edge.source !== nodeId && edge.target !== nodeId))
  context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'hash') !== nodeId)
}
