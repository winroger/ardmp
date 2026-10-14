import type { Component } from 'vue'
import type { Connection, Edge, Node } from '@vue-flow/core'
import type { DataSource } from '@/domain/DataSource'
import type { MappingEdge, MappingState } from '@/domain/Mapping'
import type { useDataStore } from '@/stores/dataStore'
import type { useMappingStore } from '@/stores/mappingStore'

type MappingStore = ReturnType<typeof useMappingStore>
type DataStore = ReturnType<typeof useDataStore>

export type SetupDialogId = string

export interface SetupDialogPayload {
  initialBaseId?: string
  nodeId?: string
}

export interface SetupDialogDefinition {
  id: SetupDialogId
  header: string
  width: string
  component: Component
  buildProps?: (payload?: SetupDialogPayload) => Record<string, unknown>
}

export interface DataSourceImportDefinition {
  id: string
  label: string
  icon: string
  dialogId: SetupDialogId
}

export interface ShapeSourceImportDefinition {
  id: string
  label: string
  icon: string
  action: 'upload-files' | 'open-dialog'
  dialogId?: SetupDialogId
}

export interface MappingNodeActionDefinition {
  id: string
  label: string
  icon: string
  category: 'enrichment' | 'transformation'
  dialogId?: SetupDialogId
  createNode?: (mappingStore: MappingStore) => void
}

export interface OpenSetupDialog {
  (dialogId: SetupDialogId, payload?: SetupDialogPayload): void
}

export interface OpenNodePreview {
  (nodeId: string): void
}

export type ExtensionCanvasEdgeDefinition = Omit<Edge, 'type'> & { type?: string }

export interface ExtensionUiEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export interface NodeRunStats {
  totalCount: number
  processedCount: number
  cachedCount: number
  lastRunAt?: string
  lastError?: string
}

export interface ExtensionCanvasBuildContext {
  dataStore: DataStore
  mappingStore: MappingStore
  visibleSources: DataSource[]
  openSetupDialog: OpenSetupDialog
  openNodePreview: OpenNodePreview
  deleteNode: (nodeId: string) => void
  isRefreshingSourceGroup: (provider: string, groupId: string) => boolean
  refreshSourceGroup: (provider: string, groupId: string) => Promise<void>
  setSourceGroupEdgeVisibility: (provider: string, groupId: string, isVisible: boolean) => void
  runNode: (nodeId: string) => Promise<void>
}

export interface ExtensionCanvasModuleDefinition {
  id: string
  buildNodes: (context: ExtensionCanvasBuildContext) => Node[]
  buildEdges?: (context: ExtensionCanvasBuildContext) => ExtensionCanvasEdgeDefinition[]
}

export interface MappingCanvasMappingEdgeSource {
  source: string
  sourceHandle?: string
}

export interface MappingCanvasMappingEdgeSourceHandler {
  id: string
  canResolve: (edge: MappingEdge) => boolean
  resolve: (edge: MappingEdge) => MappingCanvasMappingEdgeSource
}

export interface MappingExtensionModule {
  id: string
  setupDialogs?: SetupDialogDefinition[]
  dataSourceImports?: DataSourceImportDefinition[]
  shapeSourceImports?: ShapeSourceImportDefinition[]
  mappingNodeActions?: MappingNodeActionDefinition[]
  canvasNodeTypes?: Record<string, Component>
  canvasModules?: ExtensionCanvasModuleDefinition[]
  mappingEdgeSourceHandlers?: MappingCanvasMappingEdgeSourceHandler[]
  defaultNodePositions?: Partial<Record<string, Node['position']>>
  previewHandlers?: MappingNodePreviewHandler[]
  runtimeHandlers?: MappingNodeRuntimeHandler[]
  outputSourceHandlers?: MappingNodeOutputSourceHandler[]
  transformSemanticsHandlers?: MappingTransformSemanticsHandler[]
  connectionHandlers?: MappingConnectionHandler[]
  snapshotHandlers?: MappingExtensionSnapshotHandler[]
  sourceGroupHandlers?: SourceGroupHandler[]
}

export interface SourceGroupRuntimeContext {
  dataStore: DataStore
  toast: ToastLike
}

export interface SourceGroupRefreshResult {
  successSummary: string
  successDetail?: string
}

export interface SourceGroupHandler {
  id: string
  provider: string
  refreshGroup?: (groupId: string, context: SourceGroupRuntimeContext) => Promise<SourceGroupRefreshResult>
}

export interface MappingNodeRuntimeContext {
  dataStore: DataStore
  mappingStore: MappingStore
  sources: DataSource[]
}

export interface MappingNodeRuntimeResult {
  successSummary: string
  successDetail?: string
  successSeverity?: 'success' | 'warn'
}

export interface MappingNodePreviewContext {
  dataStore: DataStore
  mappingStore: MappingStore
  sources: DataSource[]
  toast: ToastLike
  openTablePreview: (source: DataSource) => void
  openPairedSourcePreview: (primarySource: DataSource | null, secondarySource: DataSource | null) => void
}

export interface MappingNodePreviewHandler {
  id: string
  canPreview: (nodeId: string) => boolean
  preview: (nodeId: string, context: MappingNodePreviewContext) => void
}

export interface MappingNodeOutputSourceContext {
  dataStore: DataStore
  mappingStore: MappingExtensionStoreApi
  sources: DataSource[]
}

export interface MappingNodeOutputSourceHandler {
  id: string
  canResolve: (nodeId: string) => boolean
  resolve: (nodeId: string, context: MappingNodeOutputSourceContext) => string | undefined
}

export interface MappingTransformValueContext {
  edge: MappingEdge
  source: DataSource
  row: unknown[]
}

export interface MappingTransformSemanticsHandler {
  id: string
  canHandle: (transformId: string | undefined) => boolean
  buildValue?: (context: MappingTransformValueContext) => string | undefined
  buildRmlTemplate?: (edge: MappingEdge) => string | undefined
}

export interface MappingNodeRuntimeHandler {
  id: string
  canRun: (nodeId: string) => boolean
  errorSummary: string
  run: (nodeId: string, context: MappingNodeRuntimeContext) => Promise<MappingNodeRuntimeResult>
}

export interface ToastLike {
  add(message: {
    severity: string
    summary: string
    detail?: string
    life?: number
  }): void
}

export interface MappingConnectionContext {
  dataStore: DataStore
  mappingStore: MappingStore
  sources: DataSource[]
  toast: ToastLike
}

export interface MappingConnectionHandler {
  id: string
  canHandleConnection: (connection: Connection) => boolean
  connect: (connection: Connection, context: MappingConnectionContext) => boolean
  deleteUiEdge?: (edgeId: string, context: MappingConnectionContext) => boolean
  deleteMappingEdge?: (edge: MappingEdge, shapeIri: string, propertyPath: string, context: MappingConnectionContext) => boolean
}

export interface MappingExtensionStoreApi {
  state: MappingState
  createExtensionNode: <T extends { id: string }>(stateKey: string, idPrefix: string, buildNode: (id: string) => T) => T
  findExtensionNode: <T extends { id: string }>(stateKey: string, nodeId: string) => T | undefined
  updateExtensionNode: <T extends { id: string }>(stateKey: string, nodeId: string, updateNode: (node: T) => T) => void
  removeExtensionNode: <T extends { id: string }>(stateKey: string, nodeId: string) => void
  upsertExtensionUiEdge: <T extends { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>(stateKey: string, edge: T) => void
  removeExtensionUiEdge: <T extends { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>(stateKey: string, edgeId: string) => { nextEdges: T[]; removed?: T }
  getExtensionState: <T>(key: string, fallback: T) => T
  setExtensionState: <T>(key: string, value: T) => void
  resetExtensionState: (key: string) => void
}

export interface MappingExtensionSnapshotContext {
  mappingStore: MappingExtensionStoreApi
}

export interface MappingExtensionSnapshotHandler {
  id: string
  createState: (context: MappingExtensionSnapshotContext) => unknown
  restoreState: (state: unknown, context: MappingExtensionSnapshotContext) => void
  resetState: (context: MappingExtensionSnapshotContext) => void
}
