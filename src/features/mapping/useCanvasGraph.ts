import { computed, ref, watch, type Ref } from 'vue'
import type { Edge, Node } from '@vue-flow/core'
import { isCanvasVisibleDataSource, type DataSource } from '@/domain/DataSource'
import type { NodeShape } from '@/domain/NodeShape'
import {
  applyDefaultExtensionEdgeStyle,
  buildCanvasMappingEdges,
  buildCanvasShapeNodes,
  buildCanvasSourceNodes,
  buildCanvasStructuralEdges,
  preserveCanvasNodePositions,
  shouldAutoLayoutCanvas,
} from '@/features/mapping/canvasGraphBuilders'
import {
  buildExtensionCanvasEdges,
  buildExtensionCanvasNodes,
  canvasNodeTypes,
  defaultPositionForNodeType,
  findRuntimeHandler,
  type OpenSetupDialog,
} from '@/features/mapping/mappingExtensionRegistry'
import { useSourceGroupRefresh } from '@/features/mapping/useSourceGroupRefresh'
import { getDependentTransformationNodeIds, syncTransformationNodeMappings } from '@/services/mapping/mappingEdgeSync'
import { getGeoNamesNode, getGeoNamesUiEdges, GEONAMES_NODE_STATE_KEY, GEONAMES_UI_EDGE_STATE_KEY, syncGeoNamesShapeMappings } from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import { getLobidNode, getLobidUiEdges, LOBID_NODE_STATE_KEY, LOBID_UI_EDGE_STATE_KEY, syncLobidShapeMappings } from '@/features/mapping/extensions/modules/nodes/lobid/workflow'
import { TRANSFORMATION_NODE_STATE_KEY, TRANSFORMATION_UI_EDGE_STATE_KEY } from '@/features/mapping/extensions/modules/nodes/lat-lng-to-wkt/state'
import type { TransformationUiEdge } from '@/features/mapping/extensions/modules/nodes/lat-lng-to-wkt/types'
import type { useDataStore } from '@/stores/dataStore'
import type { useMappingStore } from '@/stores/mappingStore'
import { layoutMappingGraph } from '@/services/mapping/graphLayout'
import { deleteMergeNode, removeMergeInputsFromNode } from '@/features/mapping/extensions/modules/nodes/merge/workflow'
import { deleteSplitNode } from '@/features/mapping/extensions/modules/nodes/split/workflow'
import { refreshTextTransforms } from '@/features/mapping/extensions/core/textTransformGraph'

type DataStore = ReturnType<typeof useDataStore>
type MappingStore = ReturnType<typeof useMappingStore>

interface ToastLike {
  add(message: {
    severity: string
    summary: string
    detail?: string
    life?: number
  }): void
}

interface ConfirmLike {
  require(options: {
    header: string
    message: string
    icon?: string
    acceptLabel?: string
    rejectLabel?: string
    acceptClass?: string
    accept: () => void
  }): void
}

interface UseCanvasGraphOptions {
  dataStore: DataStore
  mappingStore: MappingStore
  sources: Ref<DataSource[]>
  canvasShapes: Ref<NodeShape[]>
  toast: ToastLike
  confirm: ConfirmLike
  openSetupDialog: OpenSetupDialog
  openTablePreview: (source: DataSource) => void
  openNodePreview: (nodeId: string) => void
  openShapePreview: (shape: NodeShape) => void | Promise<void>
}

export function useCanvasGraph(options: UseCanvasGraphOptions) {
  const nodes = ref<Node[]>([])
  const edges = ref<Edge[]>([])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeTypes: any = canvasNodeTypes
  const visibleSources = computed(() => options.sources.value.filter(isVisibleSource))
  const {
    isRefreshingSourceGroup,
    refreshProviderSourceGroup,
    refreshingSourceGroups,
    setSourceGroupEdgeVisibility,
  } = useSourceGroupRefresh({
    dataStore: options.dataStore,
    toast: options.toast,
    readEdges: () => edges.value as Array<{ id: string; style?: unknown }>,
    writeEdges: nextEdges => {
      edges.value = nextEdges as Edge[]
    },
  })

  function positionForNewNode(node: Node, index: number): Node['position'] {
    return defaultPositionForNodeType(node.type, index)
  }

  function autoLayoutNodes(nextNodes: Node[], nextEdges: Edge[]): Node[] {
    const layout = layoutMappingGraph as unknown as (nodes: Node[], edges: Edge[]) => Node[]
    return layout(nextNodes, nextEdges)
  }

  async function runNode(nodeId: string): Promise<void> {
    const runtimeHandler = findRuntimeHandler(nodeId)
    if (!runtimeHandler) return

    try {
      const result = await runtimeHandler.run(nodeId, {
        dataStore: options.dataStore,
        mappingStore: options.mappingStore,
        sources: options.sources.value,
      })
      options.toast.add({
        severity: result.successSeverity ?? 'success',
        summary: result.successSummary,
        detail: result.successDetail,
        life: 3500,
      })
    } catch (err) {
      options.toast.add({
        severity: 'error',
        summary: runtimeHandler.errorSummary,
        detail: err instanceof Error ? err.message : String(err),
        life: 5000,
      })
    }
  }

  function deleteNode(nodeId: string): void {
    const confirmation = deleteConfirmationForNode(nodeId)
    if (!confirmation) return

    options.confirm.require({
      header: 'Delete node',
      message: confirmation.message,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptClass: 'p-button-danger',
      accept: () => {
        confirmation.accept()
        options.toast.add({ severity: 'success', summary: 'Node deleted', detail: confirmation.successDetail, life: 2500 })
      },
    })
  }

  function deleteConfirmationForNode(nodeId: string): { message: string; successDetail: string; accept: () => void } | null {
    if (nodeId.startsWith('split:')) {
      return {
        message: 'Delete this split node and its canvas connections?', successDetail: 'Split node removed.',
        accept: () => deleteSplitNode(nodeId, { mappingStore: options.mappingStore, dataStore: options.dataStore, sources: options.sources.value }),
      }
    }
    if (nodeId.startsWith('merge:')) {
      return {
        message: 'Delete this merge node and its canvas connections?',
        successDetail: 'Merge node removed.',
        accept: () => deleteMergeNode(nodeId, { mappingStore: options.mappingStore, dataStore: options.dataStore, sources: options.sources.value }),
      }
    }
    if (nodeId.startsWith('geonames:')) {
      return {
        message: 'Delete this GeoNames node and all of its generated connections?',
        successDetail: 'GeoNames node removed.',
        accept: () => { deleteGeoNamesNode(nodeId) },
      }
    }

    if (nodeId.startsWith('lobid:')) {
      return {
        message: 'Delete this Lobid node and all of its generated connections?',
        successDetail: 'Lobid node removed.',
        accept: () => { deleteLobidNode(nodeId) },
      }
    }

    if (nodeId.startsWith('transform:')) {
      return {
        message: 'Delete this transformation node and its canvas connections?',
        successDetail: 'Transformation node removed.',
        accept: () => { deleteTransformationNode(nodeId) },
      }
    }

    return null
  }

  function deleteGeoNamesNode(nodeId: string): void {
    const transformationUiEdges = options.mappingStore.getExtensionState(TRANSFORMATION_UI_EDGE_STATE_KEY, [] as TransformationUiEdge[])
    const dependentTransformIds = getDependentTransformationNodeIds(nodeId, transformationUiEdges)
    const node = getGeoNamesNode(options.mappingStore, nodeId)

    options.mappingStore.removeExtensionNode(GEONAMES_NODE_STATE_KEY, nodeId)
    options.mappingStore.setExtensionState(
      GEONAMES_UI_EDGE_STATE_KEY,
      getGeoNamesUiEdges(options.mappingStore).filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    )
    options.mappingStore.setExtensionState(
      TRANSFORMATION_UI_EDGE_STATE_KEY,
      transformationUiEdges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    )
    options.dataStore.remove(node?.outputSourceId ?? `geonames-output:${nodeId}`)
    options.dataStore.removeNodeOutputSources(nodeId)
    removeMergeInputsFromNode(nodeId, { mappingStore: options.mappingStore, dataStore: options.dataStore, sources: options.sources.value })
    options.mappingStore.state.edges = syncGeoNamesShapeMappingsRemoval(nodeId)

    for (const transformId of dependentTransformIds) {
      options.mappingStore.syncTransformationMappings(transformId, options.sources.value)
    }
  }

  function deleteLobidNode(nodeId: string): void {
    const node = getLobidNode(options.mappingStore, nodeId)

    options.mappingStore.removeExtensionNode(LOBID_NODE_STATE_KEY, nodeId)
    options.mappingStore.setExtensionState(
      LOBID_UI_EDGE_STATE_KEY,
      getLobidUiEdges(options.mappingStore).filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    )
    options.dataStore.remove(node?.outputSourceId ?? `lobid-output:${nodeId}`)
    options.dataStore.removeNodeOutputSources(nodeId)
    options.mappingStore.state.edges = syncLobidShapeMappingsRemoval(nodeId)
  }

  function deleteTransformationNode(nodeId: string): void {
    const transformationUiEdges = options.mappingStore.getExtensionState(TRANSFORMATION_UI_EDGE_STATE_KEY, [] as TransformationUiEdge[])
    options.mappingStore.removeExtensionNode(TRANSFORMATION_NODE_STATE_KEY, nodeId)
    options.mappingStore.setExtensionState(
      TRANSFORMATION_UI_EDGE_STATE_KEY,
      transformationUiEdges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    )
    options.mappingStore.state.edges = syncTransformationNodeMappings(options.mappingStore.state.edges, nodeId, undefined, '')
  }

  function syncGeoNamesShapeMappingsRemoval(nodeId: string) {
    syncGeoNamesShapeMappings(options.mappingStore, options.dataStore, nodeId, options.sources.value)
    return options.mappingStore.state.edges
  }

  function syncLobidShapeMappingsRemoval(nodeId: string) {
    syncLobidShapeMappings(options.mappingStore, options.dataStore, nodeId, options.sources.value)
    return options.mappingStore.state.edges
  }

  function rebuildGraph(): void {
    const extensionNodes: Node[] = buildExtensionCanvasNodes({
      dataStore: options.dataStore,
      mappingStore: options.mappingStore,
      visibleSources: visibleSources.value,
      openSetupDialog: options.openSetupDialog,
      openNodePreview: options.openNodePreview,
      deleteNode,
      isRefreshingSourceGroup,
      refreshSourceGroup: refreshProviderSourceGroup,
      setSourceGroupEdgeVisibility,
      runNode,
    })
    const extensionEdges: Edge[] = buildExtensionCanvasEdges({
      dataStore: options.dataStore,
      mappingStore: options.mappingStore,
      visibleSources: visibleSources.value,
      openSetupDialog: options.openSetupDialog,
      openNodePreview: options.openNodePreview,
      deleteNode,
      isRefreshingSourceGroup,
      refreshSourceGroup: refreshProviderSourceGroup,
      setSourceGroupEdgeVisibility,
      runNode,
    }).map(edge => applyDefaultExtensionEdgeStyle(edge))

    const tableNodes: Node[] = buildCanvasSourceNodes(visibleSources.value, options.openTablePreview)
    const shapeNodes: Node[] = buildCanvasShapeNodes(options.canvasShapes.value, options.openShapePreview)

    const nextNodes: Node[] = [...extensionNodes, ...tableNodes, ...shapeNodes]
    const visibleNodeIds = new Set(nextNodes.map(node => node.id))

    const mappingEdges: Edge[] = buildCanvasMappingEdges(
      options.mappingStore.state.edges,
      options.canvasShapes.value,
      visibleNodeIds,
    )
    const structuralEdges: Edge[] = buildCanvasStructuralEdges(visibleSources.value, options.canvasShapes.value)

    const allEdges: Edge[] = [...mappingEdges, ...structuralEdges, ...extensionEdges]
      .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))

    const existingNodes = nodes.value as Node[]

    if (shouldAutoLayoutCanvas(existingNodes, nextNodes)) {
      nodes.value = autoLayoutNodes(nextNodes, allEdges)
    } else {
      nodes.value = preserveCanvasNodePositions(existingNodes, nextNodes, positionForNewNode)
    }
    edges.value = allEdges
  }

  watch(
    () => options.sources.value.filter(isVisibleSource),
    (current, previous) => {
      if (previous && current.length === previous.length && current.every((source, index) => source === previous[index])) return
      refreshTextTransforms({ mappingStore: options.mappingStore, dataStore: options.dataStore, sources: options.sources.value })
    },
    { immediate: true },
  )

  watch(
    [
      () => options.sources.value.length,
      () => options.sources.value.map(source => source.id).join('|'),
      () => refreshingSourceGroups.value.join('|'),
      () => options.mappingStore.extensionStateRevision,
      options.canvasShapes,
      () => options.mappingStore.state.edges.length,
    ],
    rebuildGraph,
    { immediate: true },
  )

  return {
    nodes,
    edges,
    nodeTypes,
  }
}

function isVisibleSource(source: DataSource): boolean {
  return isCanvasVisibleDataSource(source)
}


