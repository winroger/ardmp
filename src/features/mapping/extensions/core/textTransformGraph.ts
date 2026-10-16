import type { DataSource } from '@/domain/DataSource'
import type { ExtensionUiEdge, MappingNodeOutputSourceContext, MappingExtensionStoreApi } from './types'
import { materializeMergeOutputSource, syncMergeShapeMappings } from '../modules/nodes/merge/workflow'
import { materializeSplitOutputSource, syncSplitShapeMappings } from '../modules/nodes/split/workflow'
import { materializeHashOutputSource, syncHashShapeMappings } from '../modules/nodes/hash/workflow'
import { mappingEnrichmentNodeId } from '@/domain/Mapping'
import type { GeoNamesNodeConfig } from '../modules/nodes/geonames/types'

export type TextTransformContext = Pick<MappingNodeOutputSourceContext, 'dataStore' | 'sources'> & {
  mappingStore: Pick<MappingExtensionStoreApi, 'findExtensionNode' | 'getExtensionState' | 'setExtensionState' | 'state'>
}

const textEdgeKeys = ['node.merge.uiEdges', 'node.split.uiEdges', 'node.hash.uiEdges']
const edgeKeys = [...textEdgeKeys, 'node.geonames.uiEdges']
const materializing = new Set<string>()
const syncing = new Set<string>()

export function materializeTextNode(nodeId: string, build: () => string): string | undefined {
  if (materializing.has(nodeId)) return undefined
  materializing.add(nodeId)
  try { return build() } finally { materializing.delete(nodeId) }
}

export function textInputSource(upstream: string, context: TextTransformContext): DataSource {
  let sourceId: string | undefined
  if (upstream.startsWith('src:')) sourceId = upstream.slice(4)
  else if (upstream.startsWith('merge:')) sourceId = materializeMergeOutputSource(upstream, context)
  else if (upstream.startsWith('split:')) sourceId = materializeSplitOutputSource(upstream, context)
  else if (upstream.startsWith('hash:')) sourceId = materializeHashOutputSource(upstream, context)
  else if (upstream.startsWith('geonames:')) {
    sourceId = context.mappingStore.findExtensionNode<{ id: string; outputSourceId?: string }>('node.geonames.nodes', upstream)?.outputSourceId
  }
  const source = sourceId ? context.dataStore.findById(sourceId) ?? context.sources.find(item => item.id === sourceId) : undefined
  if (!source) throw new Error(upstream.startsWith('geonames:')
    ? 'Run the GeoNames node first to make its outputs available for transformations.'
    : 'The connected input is not available. Complete its inputs first.')
  return source
}

export function wouldCreateTextCycle(source: string, target: string, mappingStore: Pick<MappingExtensionStoreApi, 'getExtensionState'>): boolean {
  const edges = edgeKeys.flatMap(key => mappingStore.getExtensionState(key, [] as ExtensionUiEdge[]))
  const pending = [target]
  const visited = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === source) return true
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...edges.filter(edge => edge.source === id).map(edge => edge.target))
  }
  return false
}

export function syncDependentTextTransforms(upstream: string, context: TextTransformContext, outputs?: readonly string[]): void {
  if (syncing.has(upstream)) return
  syncing.add(upstream)
  try {
    const dependents = new Set(textEdgeKeys.flatMap(key => context.mappingStore.getExtensionState(key, [] as ExtensionUiEdge[]))
      .filter(edge => edge.source === upstream).map(edge => edge.target))
    if (outputs) {
      for (const key of edgeKeys) {
        const edges = context.mappingStore.getExtensionState(key, [] as ExtensionUiEdge[])
        const retained = edges.filter(edge => edge.source !== upstream || outputs.includes(edge.sourceHandle.slice(2)))
        if (retained.length !== edges.length) {
          context.mappingStore.setExtensionState(key, retained)
          if (key === 'node.geonames.uiEdges') {
            const removedTargets = new Set(edges.filter(edge => !retained.includes(edge)).map(edge => edge.target))
            const nodes = context.mappingStore.getExtensionState('node.geonames.nodes', [] as GeoNamesNodeConfig[])
            context.mappingStore.setExtensionState('node.geonames.nodes', nodes.map(node => removedTargets.has(node.id)
              ? { ...node, status: 'idle', results: {}, lookupErrors: [], inputSourceId: undefined, inputHeader: undefined,
                  inputLongitudeHeader: undefined, outputSourceId: undefined,
                  stats: { totalCount: 0, processedCount: 0, cachedCount: 0 } } : node))
            for (const id of removedTargets) {
              context.dataStore.removeNodeOutputSources(id)
              context.mappingStore.state.edges = context.mappingStore.state.edges.filter(edge => mappingEnrichmentNodeId(edge, 'geonames') !== id)
              syncDependentTextTransforms(id, context)
            }
          }
        }
      }
    }
    for (const id of dependents) {
      if (id.startsWith('merge:')) syncMergeShapeMappings(id, context)
      if (id.startsWith('split:')) syncSplitShapeMappings(id, context)
      if (id.startsWith('hash:')) syncHashShapeMappings(id, context)
    }
  } finally { syncing.delete(upstream) }
}

export function refreshTextTransforms(context: TextTransformContext): void {
  for (const provider of ['merge', 'split', 'hash']) {
    for (const node of context.mappingStore.getExtensionState(`node.${provider}.nodes`, [] as { id: string }[])) {
      if (provider === 'merge') syncMergeShapeMappings(node.id, context)
      else if (provider === 'split') syncSplitShapeMappings(node.id, context)
      else syncHashShapeMappings(node.id, context)
    }
  }
}
