import { TabularDataSource, type DataSource } from '@/domain/DataSource'
import type { MappingState } from '@/domain/Mapping'
import { mappingTransformId } from '@/domain/Mapping'
import type { ApplicationProfile, NodeShape } from '@/domain/NodeShape'
import { classifyShape } from '@/domain/NodeShape'
import { findTransformSemanticsHandler } from '@/features/mapping/mappingExtensionRegistry'
import { extractValues, localNameOf } from './mappingSemantics'
import { createEntityRowResolver, createReferenceResolver, identitySourceForShape, sameRowReferences, sameRowReferenceSubjects } from './entityIdentity'
import { inheritReferenceIdentifiers } from './referenceIdentifiers'
import { isStagingSource, resolveExplicitHybridOwnerForSource, stagingSubjectForRow } from './stagingSemantics'

export interface EntityExportSource {
  source: DataSource
  subjectHeader: string
  referenceHeaders: Map<string, string>
}

function hash(value: string): string {
  let result = 2166136261
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619)
  return (result >>> 0).toString(16)
}

function containsArrays(source: DataSource): boolean {
  return source.rows.some(row => row.some(Array.isArray))
}

/** Scalar CSV rows for RML; subject identity is resolved before any expansion. */
function expandedRows(source: DataSource, row: unknown[]): unknown[][] {
  const cells = source.headers.map((_header, index) => Array.isArray(row[index])
    ? [...new Set(extractValues(row[index], undefined))] : [row[index] ?? ''])
  const length = Math.max(1, ...cells.map(values => values.length))
  // RDF properties are independent values on one subject. Padding avoids a Cartesian
  // product when several Airtable fields contain arrays, while emitting every value.
  return Array.from({ length }, (_unused, index) => cells.map((values, column) =>
    Array.isArray(row[column]) ? values[index] ?? '' : values[0]))
}

export function prepareEntityExport(shape: NodeShape, source: DataSource, ap: ApplicationProfile, mapping: MappingState, sources: DataSource[]): EntityExportSource | undefined {
  mapping = inheritReferenceIdentifiers(ap.allNodeShapes(), mapping, sources)
  const automatic = sameRowReferences(shape, source, ap, mapping, sources)
  const explicit = mapping.forShape(shape.nodeId.value).filter(edge => edge.sourceId === source.id)
    .flatMap(edge => {
      const property = shape.properties.find(item => item.path?.value === edge.propertyPath && item.node)
      const target = property?.node ? ap.findNodeShape(property.node.value) : undefined
      return property && target ? [{ edge, property, target }] : []
    })
  const identitySource = identitySourceForShape(shape, source, mapping, sources)
  const customized = identitySource.id !== source.id || mapping.subjectIdentifier(shape.nodeId.value, identitySource.id)
    || explicit.some(item => mapping.subjectIdentifiers.some(identifier => identifier.shapeIri === item.target.nodeId.value))
  if (!customized && !automatic.length && !containsArrays(source)) return undefined

  const headers = [...source.headers]
  function allocate(name: string): string {
    let header = name
    while (headers.includes(header)) header = `_${header}`
    headers.push(header)
    return header
  }
  const subjectHeader = allocate('__ardmp_subject')
  const references = [...explicit.map(item => ({ property: item.property, explicit: item, automatic: undefined })),
    ...automatic.map(item => ({ property: item.property, explicit: undefined, automatic: item }))]
  const referenceHeaders = new Map(references.map((item, index) => [item.property.path!.value, allocate(`__ardmp_reference_${index + 1}`)]))
  const rows: unknown[][] = []
  const recordIds: string[] = []
  const resolveReference = createReferenceResolver(mapping, sources)
  const resolveRows = createEntityRowResolver(mapping, sources)
  source.rows.forEach((_row, rowIdx) => {
    for (const { subject, row } of resolveRows(shape, source, rowIdx)) {
      let variants: unknown[][] = expandedRows(source, row).map(variant => [...variant, subject.value])
      for (const reference of references) {
        const explicit = reference.explicit
        const handler = explicit ? findTransformSemanticsHandler(mappingTransformId(explicit.edge)) : undefined
        variants = variants.flatMap(variant => {
          const cell = explicit ? variant[source.headers.indexOf(explicit.edge.sourceHeader)] : undefined
          const valuesToResolve = cell == null || cell === '' ? []
            : handler?.buildValue ? [handler.buildValue({ edge: explicit!.edge, source, row: variant })].filter((value): value is string => Boolean(value))
              : extractValues(cell, explicit ? mappingTransformId(explicit.edge) : undefined)
          const values = explicit
            ? valuesToResolve.flatMap(value => resolveReference(explicit.target, value).map(item => item.value))
            : sameRowReferenceSubjects(reference.automatic!, source, rowIdx, resolveRows).map(item => item.value)
          return (values.length ? values : ['']).map(value => [...variant, value])
        })
      }
      for (const variant of variants) {
        rows.push(variant)
        if (source.recordIds) recordIds.push(source.recordIds[rowIdx])
      }
    }
  })
  const key = `${shape.nodeId.value}:${source.id}`
  return {
    source: new TabularDataSource({
      id: `entities:${key}`, name: `entities_${localNameOf(shape.nodeId.value) || 'shape'}_${source.name}_${hash(key)}`,
      headers, rows, recordIds: source.recordIds ? recordIds : undefined, role: 'derived', hidden: true,
      origin: { kind: 'generated', provider: 'entity-mapping', externalRef: { shapeIri: shape.nodeId.value, sourceId: source.id } },
    }), subjectHeader, referenceHeaders,
  }
}

export function prepareStagingExport(source: DataSource, ap: ApplicationProfile, mapping: MappingState, sources: DataSource[]): EntityExportSource | undefined {
  if (!isStagingSource(source) || !containsArrays(source) || resolveExplicitHybridOwnerForSource(source, mapping, ap.allNodeShapes(), sources)) return undefined
  let subjectHeader = '__ardmp_subject'
  while (source.headers.includes(subjectHeader)) subjectHeader = `_${subjectHeader}`
  const rows: unknown[][] = []
  const recordIds: string[] = []
  source.rows.forEach((row, index) => {
    const subject = stagingSubjectForRow(source, index)
    if (!subject) return
    for (const variant of expandedRows(source, row)) {
      rows.push([...variant, subject.value])
      if (source.recordIds) recordIds.push(source.recordIds[index])
    }
  })
  return {
    source: new TabularDataSource({ id: `staging-values:${source.id}`, name: `staging_values_${source.name}_${hash(source.id)}`,
      headers: [...source.headers, subjectHeader], rows, recordIds: source.recordIds ? recordIds : undefined,
      role: 'derived', hidden: true, origin: { kind: 'generated', provider: 'entity-mapping' } }),
    subjectHeader, referenceHeaders: new Map(),
  }
}

export function entityExportSources(ap: ApplicationProfile, mapping: MappingState, sources: DataSource[]): DataSource[] {
  const entities = ap.allNodeShapes().filter(shape => classifyShape(shape) !== 'form').flatMap(shape => {
    const ids = new Set(mapping.forShape(shape.nodeId.value).map(edge => edge.sourceId))
    return sources.filter(source => ids.has(source.id)).flatMap(source => {
      const prepared = prepareEntityExport(shape, source, ap, mapping, sources)
      return prepared ? [prepared.source] : []
    })
  })
  return [...entities, ...sources.flatMap(source => {
    const prepared = prepareStagingExport(source, ap, mapping, sources)
    return prepared ? [prepared.source] : []
  })]
}
