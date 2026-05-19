import type { Edge, Node } from '@vue-flow/core'
import type { DataSource } from '@/domain/DataSource'
import type { MappingEdge } from '@/domain/Mapping'
import type { NodeShape } from '@/domain/NodeShape'
import { CANVAS_EDGE_STYLES } from '@/features/mapping/canvasTheme'
import { resolveMappingEdgeCanvasSource } from '@/features/mapping/mappingExtensionRegistry'
import { detectLinkedColumns } from '@/services/mapping/linkDetector'

export function applyDefaultExtensionEdgeStyle(edge: Omit<Edge, 'type'> & { type?: string }): Edge {
  return {
    ...edge,
    type: edge.type ?? 'default',
    style: {
      ...CANVAS_EDGE_STYLES.primary,
      ...(edge.style ?? {}),
    },
  }
}

export function buildCanvasSourceNodes(
  sources: DataSource[],
  openTablePreview: (source: DataSource) => void,
): Node[] {
  return sources.map(source => ({
    id: `src:${source.id}`,
    type: 'tableNode',
    position: { x: 0, y: 0 },
    data: { source, onPreview: () => openTablePreview(source) },
  }))
}

export function buildCanvasShapeNodes(
  shapes: NodeShape[],
  openShapePreview: (shape: NodeShape) => void | Promise<void>,
): Node[] {
  return shapes.map(shape => ({
    id: `shape:${shape.nodeId.value}`,
    type: 'shapeNode',
    position: { x: 0, y: 0 },
    data: { shape, onPreview: () => openShapePreview(shape) },
  }))
}

export function buildCanvasMappingEdges(
  mappingEdges: MappingEdge[],
  shapes: NodeShape[],
  visibleNodeIds: Set<string>,
): Edge[] {
  return mappingEdges.flatMap(edge => {
    const targetShape = shapes.find(shape => shape.nodeId.value === edge.shapeIri)
    if (!targetShape) return []

    const targetProperty = targetShape.properties.find(property => property.path?.value === edge.propertyPath)
    const sourceDescriptor = resolveMappingEdgeCanvasSource(edge) ?? { source: `src:${edge.sourceId}` }
    const target = `shape:${edge.shapeIri}`
    if (!visibleNodeIds.has(sourceDescriptor.source) || !visibleNodeIds.has(target)) return []

    return [{
      id: `e:${edge.shapeIri}::${edge.propertyPath}`,
      source: sourceDescriptor.source,
      sourceHandle: sourceDescriptor.sourceHandle ?? `h:${edge.sourceHeader}`,
      target,
      targetHandle: `p:${edge.propertyPath}`,
      animated: true,
      type: 'default',
      style: CANVAS_EDGE_STYLES.primary,
      data: {
        isFkProp: Boolean(targetProperty?.node),
      },
    }]
  })
}

export function buildCanvasStructuralEdges(
  visibleSources: DataSource[],
  shapes: NodeShape[],
): Edge[] {
  return [
    ...buildTableRelationEdges(visibleSources),
    ...buildShapeReferenceEdges(shapes),
  ]
}

function buildTableRelationEdges(visibleSources: DataSource[]): Edge[] {
  const edges: Edge[] = []

  for (const source of visibleSources) {
    const linkedColumns = detectLinkedColumns(source, visibleSources)
    for (const linkedColumn of linkedColumns) {
      if (!linkedColumn.bestTargetSourceId) continue
      edges.push({
        id: `tbl:${source.id}::${linkedColumn.header}->${linkedColumn.bestTargetSourceId}`,
        source: `src:${source.id}`,
        sourceHandle: `h:${linkedColumn.header}`,
        target: `src:${linkedColumn.bestTargetSourceId}`,
        targetHandle: 'table-parent',
        type: 'default',
        animated: false,
        style: CANVAS_EDGE_STYLES.structural,
      })
    }
  }

  return edges
}

function buildShapeReferenceEdges(shapes: NodeShape[]): Edge[] {
  const edges: Edge[] = []
  const canvasIriSet = new Set(shapes.map(shape => shape.nodeId.value))

  for (const shape of shapes) {
    for (const property of shape.properties) {
      if (!property.node || !property.path) continue
      if (!canvasIriSet.has(property.node.value)) continue
      edges.push({
        id: `ref:${shape.nodeId.value}::${property.path.value}->${property.node.value}`,
        source: `shape:${shape.nodeId.value}`,
        sourceHandle: `ref:${property.path.value}`,
        target: `shape:${property.node.value}`,
        targetHandle: 'shape-header',
        type: 'default',
        animated: false,
        style: CANVAS_EDGE_STYLES.structural,
      })
    }
  }

  return edges
}

export function preserveCanvasNodePositions(
  existingNodes: Node[],
  nextNodes: Node[],
  positionForNewNode: (node: Node, index: number) => Node['position'],
): Node[] {
  const existingPositions = new Map<string, Node['position']>()
  for (const node of existingNodes) {
    existingPositions.set(node.id, node.position)
  }

  return nextNodes.map((node, index) => ({
    ...node,
    position: existingPositions.get(node.id) ?? positionForNewNode(node, index),
  }))
}

export function shouldAutoLayoutCanvas(existingNodes: Node[], nextNodes: Node[]): boolean {
  if (existingNodes.length === 0) return nextNodes.length > 0

  const existingIds = new Set(existingNodes.map(node => node.id))
  return nextNodes.some(node => !existingIds.has(node.id))
}
