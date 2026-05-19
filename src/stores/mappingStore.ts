import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { MappingState, type MappingEdge, type MappingTransformId } from '@/domain/Mapping'
import type { DataSource } from '@/domain/DataSource'
import type { TransformationNodeConfig, TransformationUiEdge } from '@/features/mapping/extensions/modules/nodes/lat-lng-to-wkt/types'
import {
  createExtensionSnapshotState,
  resolveMaterializedNodeOutputSource,
  resetExtensionSnapshotState,
  restoreExtensionSnapshotState,
} from '@/features/mapping/mappingExtensionRegistry'
import type { MappingExtensionStoreApi } from '@/features/mapping/extensions/core/types'
import {
  getTransformationNodeInputs,
  removeUiEdgeById,
  resolveTransformationMappingInput,
  syncTransformationNodeMappings,
  upsertUiEdge,
} from '@/services/mapping/mappingEdgeSync'
import { cloneMappingEdges, type MappingStoreSnapshot } from '@/services/project/projectSnapshot'
import { useDataStore } from '@/stores/dataStore'

export const useMappingStore = defineStore('mapping', () => {
  const state = reactive(new MappingState()) as MappingState
  const dataStore = useDataStore()
  const extensionState = ref<Record<string, unknown>>({})
  const extensionStateRevision = ref(0)

  function getExtensionState<T>(key: string, fallback: T): T {
    const value = extensionState.value[key]
    return value === undefined ? fallback : value as T
  }

  function setExtensionState<T>(key: string, value: T): void {
    extensionState.value = {
      ...extensionState.value,
      [key]: value,
    }
    extensionStateRevision.value++
  }

  function resetExtensionState(key: string): void {
    const nextState = { ...extensionState.value }
    delete nextState[key]
    extensionState.value = nextState
    extensionStateRevision.value++
  }

  function createExtensionNode<T extends { id: string }>(stateKey: string, idPrefix: string, buildNode: (id: string) => T): T {
    const node = buildNode(`${idPrefix}:${crypto.randomUUID()}`)
    const currentNodes = getExtensionState(stateKey, [] as T[])
    setExtensionState(stateKey, [...currentNodes, node])
    return node
  }

  function findExtensionNode<T extends { id: string }>(stateKey: string, nodeId: string): T | undefined {
    const nodes = getExtensionState(stateKey, [] as T[])
    return nodes.find(node => node.id === nodeId)
  }

  function updateExtensionNode<T extends { id: string }>(stateKey: string, nodeId: string, updateNode: (node: T) => T): void {
    const nodes = getExtensionState(stateKey, [] as T[])
    setExtensionState(stateKey, nodes.map(node => (node.id === nodeId ? updateNode(node) : node)))
  }

  function upsertExtensionUiEdge<T extends { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>(
    stateKey: string,
    edge: T,
  ): void {
    const currentEdges = getExtensionState(stateKey, [] as T[])
    setExtensionState(stateKey, upsertUiEdge(currentEdges, edge))
  }

  function removeExtensionUiEdge<T extends { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>(
    stateKey: string,
    edgeId: string,
  ): { nextEdges: T[]; removed?: T } {
    const currentEdges = getExtensionState(stateKey, [] as T[])
    const { nextEdges, removed } = removeUiEdgeById(currentEdges, edgeId)
    setExtensionState(stateKey, nextEdges)
    return {
      nextEdges,
      removed: removed as T | undefined,
    }
  }

  const transformationNodes = computed<TransformationNodeConfig[]>({
    get: () => getExtensionState('node.transformation.nodes', [] as TransformationNodeConfig[]),
    set: value => setExtensionState('node.transformation.nodes', value),
  })
  const transformationUiEdges = computed<TransformationUiEdge[]>({
    get: () => getExtensionState('node.transformation.uiEdges', [] as TransformationUiEdge[]),
    set: value => setExtensionState('node.transformation.uiEdges', value),
  })

  function set(edge: MappingEdge): void {
    state.addOrReplace(edge)
  }

  function unset(shapeIri: string, propertyPath: string): void {
    state.remove(shapeIri, propertyPath)
  }

  function addTransformationNode(kind: MappingTransformId = 'lat-lng-to-wkt'): TransformationNodeConfig {
    return createExtensionNode<TransformationNodeConfig>('node.transformation.nodes', 'transform', id => ({
      id,
      kind,
    }))
  }

  function transformationInputsForNode(nodeId: string): { lat?: TransformationUiEdge; lng?: TransformationUiEdge } {
    return getTransformationNodeInputs(nodeId, transformationUiEdges.value)
  }

  function syncTransformationMappings(nodeId: string, sources: DataSource[] = dataStore.sources): void {
    const node = findExtensionNode<TransformationNodeConfig>('node.transformation.nodes', nodeId)
    const input = resolveTransformationMappingInput(
      nodeId,
      transformationUiEdges.value,
      upstreamNodeId => resolveMaterializedNodeOutputSource(upstreamNodeId, {
        dataStore,
        mappingStore: extensionStoreApi,
        sources,
      }),
    )

    if (!node || !input) {
      state.edges = syncTransformationNodeMappings(state.edges, nodeId, undefined, node?.kind ?? '')
      return
    }

    state.edges = syncTransformationNodeMappings(state.edges, nodeId, input, node.kind)
  }

  function upsertTransformationUiEdge(edge: TransformationUiEdge): void {
    upsertExtensionUiEdge<TransformationUiEdge>('node.transformation.uiEdges', edge)
    if (edge.target.startsWith('transform:')) syncTransformationMappings(edge.target)
  }

  function removeTransformationUiEdge(edgeId: string): void {
    const { removed } = removeExtensionUiEdge<TransformationUiEdge>('node.transformation.uiEdges', edgeId)
    if (removed?.target.startsWith('transform:')) syncTransformationMappings(removed.target)
  }
  function createSnapshot(): MappingStoreSnapshot {
    return {
      edges: cloneMappingEdges(state.edges),
      extensionState: createExtensionSnapshotState({ mappingStore: extensionStoreApi }),
    }
  }

  function restoreSnapshot(snapshot: MappingStoreSnapshot): void {
    state.edges = cloneMappingEdges(snapshot.edges)
    restoreExtensionSnapshotState(snapshot.extensionState, { mappingStore: extensionStoreApi })
  }

  function reset(): void {
    state.clear()
    resetExtensionSnapshotState({ mappingStore: extensionStoreApi })
  }

  const extensionStoreApi: MappingExtensionStoreApi = {
    get state() { return state },
    createExtensionNode,
    findExtensionNode,
    updateExtensionNode,
    upsertExtensionUiEdge,
    removeExtensionUiEdge,
    getExtensionState,
    setExtensionState,
    resetExtensionState,
  }

  return {
    state,
    extensionStateRevision,
    transformationNodes,
    transformationUiEdges,
    createExtensionNode,
    findExtensionNode,
    updateExtensionNode,
    upsertExtensionUiEdge,
    removeExtensionUiEdge,
    getExtensionState,
    setExtensionState,
    resetExtensionState,
    set,
    unset,
    addTransformationNode,
    transformationInputsForNode,
    syncTransformationMappings,
    upsertTransformationUiEdge,
    removeTransformationUiEdge,
    createSnapshot,
    restoreSnapshot,
    reset,
  }
})


