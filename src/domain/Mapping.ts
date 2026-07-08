/**
 * Mapping
 *
 * Maps NodeShape properties (identified by NodeShape IRI + property path IRI)
 * to a column of a data source.
 *
 * Internally stored as a flat array of edges so that the mapping canvas can
 * render and serialise them efficiently.
 */

export interface MappingEdge {
  /**
   * Typed source descriptor for new code paths. The flat fields below remain
   * for project snapshot compatibility and are kept in sync by helper builders.
   */
  source?: MappingEdgeSource
  /** ID of the source DataSource */
  sourceId: string
  /** Header name within the source */
  sourceHeader: string
  /** IRI of the target NodeShape */
  shapeIri: string
  /** IRI of the target property path (sh:path value) */
  propertyPath: string
  /** Optional: cell-value transformation (split, prefix…) */
  transform?: MappingTransformId
  /** Optional second source header for two-input transforms such as lat/lng → WKT. */
  secondarySourceHeader?: string
  /** Optional canvas node id for transform-backed mappings. */
  transformNodeId?: string
}

import {
  createEmptyStagingColumnSelectionState,
  isStagingColumnActive,
  setStagingColumnActive,
  type StagingColumnSelectionState,
} from '@/services/mapping/stagingSemantics'

export type MappingTransformId = string

export type MappingEdgeSource =
  | { kind: 'table-column' }
  | {
      kind: 'transform-output'
      nodeId: string
      transformId: MappingTransformId
      secondarySourceHeader: string
    }
  | {
      kind: 'node-output'
      provider: string
      nodeId: string
    }

export function createColumnMappingEdge(edge: Omit<MappingEdge, 'source'>): MappingEdge {
  return {
    ...edge,
    source: { kind: 'table-column' },
  }
}

export function createTransformMappingEdge(
  edge: Omit<MappingEdge, 'source' | 'transform' | 'secondarySourceHeader' | 'transformNodeId'>,
  transform: {
    nodeId: string
    transformId: MappingTransformId
    secondarySourceHeader: string
  },
): MappingEdge {
  return {
    ...edge,
    transform: transform.transformId,
    secondarySourceHeader: transform.secondarySourceHeader,
    transformNodeId: transform.nodeId,
    source: {
      kind: 'transform-output',
      nodeId: transform.nodeId,
      transformId: transform.transformId,
      secondarySourceHeader: transform.secondarySourceHeader,
    },
  }
}

export function createEnrichmentMappingEdge(
  edge: Omit<MappingEdge, 'source'>,
  enrichment: {
    provider: string
    nodeId: string
  },
): MappingEdge {
  return {
    ...edge,
    source: {
      kind: 'node-output',
      provider: enrichment.provider,
      nodeId: enrichment.nodeId,
    },
  }
}

export function mappingTransformId(edge: MappingEdge): MappingTransformId | undefined {
  return edge.source?.kind === 'transform-output'
    ? edge.source.transformId
    : edge.transform
}

export function mappingTransformNodeId(edge: MappingEdge): string | undefined {
  return edge.source?.kind === 'transform-output'
    ? edge.source.nodeId
    : edge.transformNodeId
}

export function mappingSecondarySourceHeader(edge: MappingEdge): string | undefined {
  return edge.source?.kind === 'transform-output'
    ? edge.source.secondarySourceHeader
    : edge.secondarySourceHeader
}

export function mappingEnrichmentNodeId(edge: MappingEdge, provider?: string): string | undefined {
  if (edge.source?.kind === 'node-output') {
    if (!provider || edge.source.provider === provider) return edge.source.nodeId
  }
  return undefined
}

export function mappingOwnedByNode(edge: MappingEdge, nodeId: string): boolean {
  return mappingTransformNodeId(edge) === nodeId
    || mappingEnrichmentNodeId(edge) === nodeId
}

export class MappingState {
  edges: MappingEdge[] = []
  stagingColumns: StagingColumnSelectionState = createEmptyStagingColumnSelectionState()

  /** Adds or replaces the mapping for a given (shape, property) pair. */
  addOrReplace(edge: MappingEdge): void {
    const idx = this.edges.findIndex(
      e => e.shapeIri === edge.shapeIri && e.propertyPath === edge.propertyPath,
    )
    if (idx >= 0) this.edges[idx] = edge
    else this.edges.push(edge)
  }

  remove(shapeIri: string, propertyPath: string): void {
    this.edges = this.edges.filter(
      e => !(e.shapeIri === shapeIri && e.propertyPath === propertyPath),
    )
  }

  /** Lookup: which edge maps a given property of a given shape? */
  forProperty(shapeIri: string, propertyPath: string): MappingEdge | undefined {
    return this.edges.find(
      e => e.shapeIri === shapeIri && e.propertyPath === propertyPath,
    )
  }

  /** All edges for a given shape (i.e. all mapped properties). */
  forShape(shapeIri: string): MappingEdge[] {
    return this.edges.filter(e => e.shapeIri === shapeIri)
  }

  /** Returns the source ID a shape draws data from (first mapped property). */
  sourceForShape(shapeIri: string): string | undefined {
    return this.forShape(shapeIri)[0]?.sourceId
  }

  /** True when at least one edge exists. */
  get hasMappings(): boolean {
    return this.edges.length > 0
  }

  hasStagingMappingsForSource(sourceId: string, headers: string[]): boolean {
    return headers.some(header => this.isStagingColumnActive(sourceId, header))
  }

  stagingGraphStateForSource(
    sourceId: string,
    headers: string[],
    lockedHeaders: string[] = [],
  ): 'enabled' | 'disabled' | 'partial' {
    const eligibleHeaders = headers.filter(header => !lockedHeaders.includes(header))
    if (eligibleHeaders.length === 0) return 'enabled'

    const activeCount = eligibleHeaders.filter(header => this.isStagingColumnActive(sourceId, header)).length
    if (activeCount === 0) return 'disabled'
    if (activeCount === eligibleHeaders.length) return 'enabled'
    return 'partial'
  }

  isStagingColumnActive(sourceId: string, header: string): boolean {
    return isStagingColumnActive(this.stagingColumns, sourceId, header)
  }

  setStagingColumnActive(sourceId: string, header: string, active: boolean): void {
    this.stagingColumns = setStagingColumnActive(this.stagingColumns, sourceId, header, active)
  }

  setStagingGraphActive(
    sourceId: string,
    headers: string[],
    active: boolean,
    lockedHeaders: string[] = [],
  ): void {
    const eligibleHeaders = headers.filter(header => !lockedHeaders.includes(header))
    for (const header of eligibleHeaders) {
      this.stagingColumns = setStagingColumnActive(this.stagingColumns, sourceId, header, active)
    }
  }

  clear(): void {
    this.edges = []
    this.stagingColumns = createEmptyStagingColumnSelectionState()
  }
}


