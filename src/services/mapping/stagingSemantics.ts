import { namedNode, type NamedNode, type Store } from 'rdflib'
import { isCanvasVisibleDataSource, type DataSource } from '@/domain/DataSource'
import type { NodeShape } from '@/domain/NodeShape'
import type { MappingState } from '@/domain/Mapping'
import { detectLinkedColumns, splitLinkedRecordCell } from '@/services/mapping/linkDetector'
import { createEntitySubjectResolver, identitySourceForShape } from '@/services/mapping/entityIdentity'
import { inheritReferenceIdentifiers } from '@/services/mapping/referenceIdentifiers'
import {
  AIRTABLE_RECORD_ID_COLUMN,
  exportedHeadersForSource,
  exportedRowsForSource,
  instanceTemplateForShape,
  subjectReferenceForSource,
  subjectFor,
} from '@/services/mapping/mappingSemantics'

export const ARDMP_STAGING_CLASS_BASE = 'https://w3id.org/ardmp/staging/class/'
export const ARDMP_STAGING_PROPERTY_BASE = 'https://w3id.org/ardmp/staging/property/'
export const ARDMP_STAGING_INSTANCE_BASE = 'https://w3id.org/ardmp/staging/instance/'

export interface StagingColumnSelectionState {
  inactiveColumnsBySource: Record<string, string[]>
}

export interface StagingColumnDescriptor {
  header: string
  property: NamedNode
  linkedTargetSourceId?: string
}

export interface ExplicitHybridOwner {
  representativeShape: NodeShape
  mappedShapes: NodeShape[]
  subjectTemplate: string
}

export function createEmptyStagingColumnSelectionState(): StagingColumnSelectionState {
  return {
    inactiveColumnsBySource: {},
  }
}

export function isStagingSource(source: DataSource): boolean {
  return source.kind === 'tabular' && isCanvasVisibleDataSource(source)
}

export function isStagingColumnActive(
  selection: StagingColumnSelectionState | undefined,
  sourceId: string,
  header: string,
): boolean {
  const inactiveHeaders = selection?.inactiveColumnsBySource[sourceId] ?? []
  return !inactiveHeaders.includes(header)
}

export function setStagingColumnActive(
  selection: StagingColumnSelectionState,
  sourceId: string,
  header: string,
  active: boolean,
): StagingColumnSelectionState {
  const inactiveHeaders = new Set(selection.inactiveColumnsBySource[sourceId] ?? [])
  if (active) inactiveHeaders.delete(header)
  else inactiveHeaders.add(header)

  const nextInactiveColumnsBySource = { ...selection.inactiveColumnsBySource }
  if (inactiveHeaders.size === 0) delete nextInactiveColumnsBySource[sourceId]
  else nextInactiveColumnsBySource[sourceId] = Array.from(inactiveHeaders)

  return {
    inactiveColumnsBySource: nextInactiveColumnsBySource,
  }
}

export function hasExplicitSourceHeaderMapping(mapping: MappingState, sourceId: string, header: string): boolean {
  return mapping.edges.some(edge =>
    edge.sourceId === sourceId
    && (edge.sourceHeader === header || edge.secondarySourceHeader === header),
  )
}

export function stagingColumnsForSource(source: DataSource, mapping: MappingState): StagingColumnDescriptor[] {
  return stagingColumnsForSourceWithRelations(source, mapping, [source])
}

export function stagingColumnsForSourceWithRelations(
  source: DataSource,
  mapping: MappingState,
  allSources: DataSource[],
): StagingColumnDescriptor[] {
  const linkedColumns = new Map(
    detectLinkedColumns(source, allSources).map(column => [column.header, column]),
  )

  return source.headers
    .filter(header => isStagingColumnActive(mapping.stagingColumns, source.id, header))
    .filter(header => !hasExplicitSourceHeaderMapping(mapping, source.id, header))
    .map(header => ({
      header,
      property: stagingPropertyForColumn(source, header),
      linkedTargetSourceId: linkedColumns.get(header)?.bestTargetSourceId,
    }))
}

export function stagingClassForSource(source: DataSource): NamedNode {
  return namedNode(`${ARDMP_STAGING_CLASS_BASE}${sanitizeSegment(source.name, 'source')}`)
}

export function stagingPropertyForColumn(source: DataSource, header: string): NamedNode {
  const tableName = sanitizeSegment(source.name, 'source')
  const columnName = sanitizeSegment(header, 'column')
  return namedNode(`${ARDMP_STAGING_PROPERTY_BASE}${tableName}__${columnName}`)
}

export function stagingSubjectTemplateForSource(source: DataSource): string | undefined {
  const reference = stagingIdentifierReferenceForSource(source)
  if (!reference) return undefined
  return `${ARDMP_STAGING_INSTANCE_BASE}{${reference}}`
}

export function stagingSubjectForRow(source: DataSource, rowIdx: number): NamedNode | undefined {
  const identifier = stagingIdentifierValueForRow(source, rowIdx)
  if (!identifier) return undefined
  return namedNode(`${ARDMP_STAGING_INSTANCE_BASE}${encodeURIComponent(identifier)}`)
}

export function resolveExplicitHybridOwnerForSource(
  source: DataSource,
  mapping: MappingState,
  shapes: readonly NodeShape[],
  sources: readonly DataSource[] = [source],
): ExplicitHybridOwner | undefined {
  mapping = inheritReferenceIdentifiers(shapes, mapping, sources)
  const shapeLookup = new Map(shapes.map(shape => [shape.nodeId.value, shape]))
  const mappedShapes: NodeShape[] = []
  const seenShapeIds = new Set<string>()

  for (const edge of mapping.edges) {
    if (edge.sourceId !== source.id) continue
    const shape = shapeLookup.get(edge.shapeIri)
    if (!shape || seenShapeIds.has(shape.nodeId.value)) continue
    seenShapeIds.add(shape.nodeId.value)
    mappedShapes.push(shape)
  }

  if (mappedShapes.length === 0) return undefined

  const shapesByTemplate = new Map<string, NodeShape[]>()
  for (const shape of mappedShapes) {
    const template = instanceTemplateForShape(shape, identitySourceForShape(shape, source, mapping, sources), mapping)
    const group = shapesByTemplate.get(template)
    if (group) group.push(shape)
    else shapesByTemplate.set(template, [shape])
  }

  if (shapesByTemplate.size !== 1) return undefined

  const [subjectTemplate, templateShapes] = Array.from(shapesByTemplate.entries())[0]
  return {
    representativeShape: templateShapes[0],
    mappedShapes: templateShapes,
    subjectTemplate,
  }
}

export function hybridTargetClassForOwner(owner: ExplicitHybridOwner): NamedNode | undefined {
  return owner.representativeShape.targetClass
    ?? (owner.representativeShape.nodeId.termType === 'NamedNode' ? owner.representativeShape.nodeId : undefined)
}

export function subjectForHybridOwnerRow(
  owner: ExplicitHybridOwner,
  source: DataSource,
  row: unknown[],
  rowIdx: number,
  mapping?: MappingState,
  sources?: DataSource[],
): NamedNode | undefined {
  if (mapping && sources) return createEntitySubjectResolver(mapping, sources)(owner.representativeShape, source, rowIdx)
  return subjectFor(owner.representativeShape, source, row, rowIdx, mapping)
}

export function registerStagingPrefixes(store: Store, sources: DataSource[]): void {
  const mutableStore = store as Store & { setPrefixForURI?: (prefix: string, iri: string) => void }
  if (!sources.some(source => isStagingSource(source))) return

  mutableStore.setPrefixForURI?.('ardmp_inst', ARDMP_STAGING_INSTANCE_BASE)
  mutableStore.setPrefixForURI?.('ardmp_prop', ARDMP_STAGING_PROPERTY_BASE)
  mutableStore.setPrefixForURI?.('ardmp_class', ARDMP_STAGING_CLASS_BASE)
}

export function normalizeStagingTurtlePrefixes(turtle: string): string {
  const removablePrefixes = Array.from(turtle.matchAll(/^@prefix\s+([A-Za-z][\w-]*):\s+<([^>]+)>\s*\.\s*$/gm))
    .map(([, prefix, iri]) => ({ prefix, iri }))
    .filter(({ iri }) =>
      ((iri.startsWith(ARDMP_STAGING_INSTANCE_BASE) && iri !== ARDMP_STAGING_INSTANCE_BASE)
      || (iri.startsWith(ARDMP_STAGING_PROPERTY_BASE) && iri !== ARDMP_STAGING_PROPERTY_BASE)),
    )

  let normalized = turtle
  for (const { prefix, iri } of removablePrefixes) {
    const usagePattern = new RegExp(`(^|[^\\w-])${escapeRegExp(prefix)}:([A-Za-z0-9._~%-]+)`, 'gm')
    normalized = normalized.replace(usagePattern, (_match, leading, localName: string) => {
      return `${leading}<${iri}${localName}>`
    })
  }

  if (removablePrefixes.length === 0) return normalized

  const removableNames = new Set(removablePrefixes.map(({ prefix }) => prefix))
  const lines = normalized
    .split(/\r?\n/)
    .filter(line => {
      const prefixMatch = line.match(/^@prefix\s+([A-Za-z][\w-]*):\s+</)
      return !prefixMatch || !removableNames.has(prefixMatch[1])
    })

  return lines.join('\n')
}

export function stagingTargetSubjectForRecordId(
  targetSource: DataSource | undefined,
  recordId: string,
  hybridOwner: ExplicitHybridOwner | undefined,
  mapping?: MappingState,
  sources?: DataSource[],
): NamedNode | undefined {
  if (!targetSource?.recordIds?.length) return undefined
  const rowIdx = targetSource.recordIds.indexOf(recordId)
  if (rowIdx < 0) return undefined

  if (hybridOwner) {
    const row = targetSource.rows[rowIdx]
    return row ? subjectForHybridOwnerRow(hybridOwner, targetSource, row, rowIdx, mapping, sources) : undefined
  }

  return namedNode(`${ARDMP_STAGING_INSTANCE_BASE}${encodeURIComponent(recordId)}`)
}

export function stagingRelationshipObjectsForValue(
  column: StagingColumnDescriptor,
  cellValue: unknown,
  allSources: DataSource[],
  hybridOwnersBySourceId: ReadonlyMap<string, ExplicitHybridOwner> = new Map(),
  mapping?: MappingState,
): NamedNode[] {
  if (!column.linkedTargetSourceId) return []
  const targetSource = allSources.find(source => source.id === column.linkedTargetSourceId)
  const hybridOwner = column.linkedTargetSourceId
    ? hybridOwnersBySourceId.get(column.linkedTargetSourceId)
    : undefined
  return splitLinkedRecordCell(cellValue)
    .map(recordId => stagingTargetSubjectForRecordId(targetSource, recordId, hybridOwner, mapping, allSources))
    .filter((node): node is NamedNode => Boolean(node))
}

export function stagingIdentifierReferenceForSource(source: DataSource): string | undefined {
  const reference = subjectReferenceForSource(source)
  if (reference) return reference
  return exportedHeadersForSource(source)[0]
}

export function stagingIdentifierValueForRow(source: DataSource, rowIdx: number): string | undefined {
  const reference = stagingIdentifierReferenceForSource(source)
  if (!reference) return undefined

  if (reference === AIRTABLE_RECORD_ID_COLUMN) {
    const recordId = source.recordIds?.[rowIdx]
    return recordId ? String(recordId) : `${source.id}-row${rowIdx}`
  }

  const exportedHeaders = exportedHeadersForSource(source)
  const referenceIndex = exportedHeaders.indexOf(reference)
  if (referenceIndex < 0) return `${source.id}-row${rowIdx}`

  const exportedRow = exportedRowsForSource(source)[rowIdx]
  const rawValue = exportedRow?.[referenceIndex]
  const identifier = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim()
  return identifier || `${source.id}-row${rowIdx}`
}

function sanitizeSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return sanitized || fallback
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

