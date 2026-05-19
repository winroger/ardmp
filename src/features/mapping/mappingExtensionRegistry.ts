import { defineAsyncComponent, markRaw } from 'vue'
import type { Node } from '@vue-flow/core'
import type {
  DataSourceImportDefinition,
  ExtensionCanvasEdgeDefinition,
  ExtensionCanvasBuildContext,
  MappingCanvasMappingEdgeSource,
  MappingCanvasMappingEdgeSourceHandler,
  MappingConnectionHandler,
  MappingNodeActionDefinition,
  MappingNodeOutputSourceContext,
  MappingNodeOutputSourceHandler,
  MappingNodePreviewHandler,
  MappingNodeRuntimeHandler,
  MappingTransformSemanticsHandler,
  MappingExtensionSnapshotContext,
  MappingExtensionSnapshotHandler,
  SetupDialogDefinition,
  SetupDialogId,
  ShapeSourceImportDefinition,
  SourceGroupHandler,
  SourceGroupRuntimeContext,
  SourceGroupRefreshResult,
} from '@/features/mapping/extensions/core/types'
import { mappingExtensionModules } from '@/features/mapping/extensions/modules'

/**
 * App-internal registry for current mapping UI/runtime modules.
 *
 * This is not a public plugin API.
 * Do not build external extension contracts on top of this until
 * PipelineState and core export boundaries are stable.
 */
const TableNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/TableNode.vue'))
const ShapeNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/ShapeNode.vue'))

export type {
  DataSourceImportDefinition,
  ExtensionCanvasBuildContext,
  MappingCanvasMappingEdgeSource,
  MappingConnectionHandler,
  MappingNodeActionDefinition,
  MappingNodeOutputSourceContext,
  MappingNodeRuntimeHandler,
  MappingTransformSemanticsHandler,
  MappingExtensionSnapshotContext,
  MappingExtensionSnapshotHandler,
  SetupDialogDefinition,
  SetupDialogId,
  ShapeSourceImportDefinition,
} from '@/features/mapping/extensions/core/types'
export type { OpenSetupDialog, SetupDialogPayload } from '@/features/mapping/extensions/core/types'

export const setupDialogDefinitions: SetupDialogDefinition[] = mappingExtensionModules.flatMap(module => module.setupDialogs ?? [])

export const dataSourceImportDefinitions: DataSourceImportDefinition[] = mappingExtensionModules.flatMap(module => module.dataSourceImports ?? [])

export const shapeSourceImportDefinitions: ShapeSourceImportDefinition[] = mappingExtensionModules.flatMap(module => module.shapeSourceImports ?? [])

export const mappingNodeActionDefinitions: MappingNodeActionDefinition[] = mappingExtensionModules.flatMap(module => module.mappingNodeActions ?? [])

const runtimeHandlers: MappingNodeRuntimeHandler[] = mappingExtensionModules.flatMap(module => module.runtimeHandlers ?? [])

const previewHandlers: MappingNodePreviewHandler[] = mappingExtensionModules.flatMap(module => module.previewHandlers ?? [])

const outputSourceHandlers: MappingNodeOutputSourceHandler[] = mappingExtensionModules.flatMap(module => module.outputSourceHandlers ?? [])

const transformSemanticsHandlers: MappingTransformSemanticsHandler[] = mappingExtensionModules.flatMap(module => module.transformSemanticsHandlers ?? [])

const connectionHandlers: MappingConnectionHandler[] = mappingExtensionModules.flatMap(module => module.connectionHandlers ?? [])

const snapshotHandlers: MappingExtensionSnapshotHandler[] = mappingExtensionModules.flatMap(module => module.snapshotHandlers ?? [])
const sourceGroupHandlers: SourceGroupHandler[] = mappingExtensionModules.flatMap(module => module.sourceGroupHandlers ?? [])

const extensionCanvasNodeTypes = Object.assign({}, ...mappingExtensionModules.map(module => module.canvasNodeTypes ?? {}))
const mappingEdgeSourceHandlers: MappingCanvasMappingEdgeSourceHandler[] = mappingExtensionModules.flatMap(module => module.mappingEdgeSourceHandlers ?? [])

export const canvasNodeTypes = {
  ...extensionCanvasNodeTypes,
  tableNode: markRaw(TableNode),
  shapeNode: markRaw(ShapeNode),
}
const defaultNodePositions: Partial<Record<string, Node['position']>> = {
  ...Object.assign({}, ...mappingExtensionModules.map(module => module.defaultNodePositions ?? {})),
  tableNode: { x: 360, y: 40 },
  shapeNode: { x: 760, y: 40 },
}

export function getSetupDialogDefinition(dialogId: SetupDialogId | null): SetupDialogDefinition | null {
  if (!dialogId) return null
  return setupDialogDefinitions.find(definition => definition.id === dialogId) ?? null
}

export function buildExtensionCanvasNodes(context: ExtensionCanvasBuildContext): Node[] {
  return mappingExtensionModules.flatMap(module => (module.canvasModules ?? []).flatMap(canvasModule => canvasModule.buildNodes(context)))
}

export function buildExtensionCanvasEdges(context: ExtensionCanvasBuildContext): ExtensionCanvasEdgeDefinition[] {
  return mappingExtensionModules.flatMap(module => (module.canvasModules ?? []).flatMap(canvasModule => canvasModule.buildEdges?.(context) ?? []))
}

export function resolveMappingEdgeCanvasSource(edge: Parameters<MappingCanvasMappingEdgeSourceHandler['resolve']>[0]): MappingCanvasMappingEdgeSource | undefined {
  const handler = mappingEdgeSourceHandlers.find(candidate => candidate.canResolve(edge))
  return handler?.resolve(edge)
}

export function findRuntimeHandler(nodeId: string): MappingNodeRuntimeHandler | undefined {
  return runtimeHandlers.find(handler => handler.canRun(nodeId))
}

export function findPreviewHandler(nodeId: string): MappingNodePreviewHandler | undefined {
  return previewHandlers.find(handler => handler.canPreview(nodeId))
}

export function resolveMaterializedNodeOutputSource(nodeId: string, context: MappingNodeOutputSourceContext): string | undefined {
  const handler = outputSourceHandlers.find(candidate => candidate.canResolve(nodeId))
  return handler?.resolve(nodeId, context)
}

export function findTransformSemanticsHandler(transformId: string | undefined): MappingTransformSemanticsHandler | undefined {
  return transformSemanticsHandlers.find(handler => handler.canHandle(transformId))
}

export function getConnectionHandlers(): MappingConnectionHandler[] {
  return connectionHandlers
}

export function createExtensionSnapshotState(context: MappingExtensionSnapshotContext): Record<string, unknown> {
  return Object.fromEntries(snapshotHandlers.map(handler => [handler.id, handler.createState(context)]))
}

export function restoreExtensionSnapshotState(extensionState: Record<string, unknown> | undefined, context: MappingExtensionSnapshotContext): void {
  for (const handler of snapshotHandlers) {
    handler.restoreState(extensionState?.[handler.id], context)
  }
}

export function resetExtensionSnapshotState(context: MappingExtensionSnapshotContext): void {
  for (const handler of snapshotHandlers) {
    handler.resetState(context)
  }
}

export async function refreshSourceGroup(
  provider: string,
  groupId: string,
  context: SourceGroupRuntimeContext,
): Promise<SourceGroupRefreshResult | undefined> {
  const handler = sourceGroupHandlers.find(candidate => candidate.provider === provider && candidate.refreshGroup)
  return handler?.refreshGroup?.(groupId, context)
}

export function defaultPositionForNodeType(nodeType: string | undefined, index: number): Node['position'] {
  const base = nodeType ? defaultNodePositions[nodeType] : undefined
  if (!base) return { x: 760, y: 40 + index * 220 }
  const step = nodeType === 'hubNode' ? 180 : 220
  return { x: base.x, y: base.y + index * step }
}



