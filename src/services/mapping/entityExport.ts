import { TabularDataSource, type DataSource } from '@/domain/DataSource'
import type { MappingState } from '@/domain/Mapping'
import { mappingTransformId } from '@/domain/Mapping'
import type { ApplicationProfile, NodeShape } from '@/domain/NodeShape'
import { classifyShape } from '@/domain/NodeShape'
import { findTransformSemanticsHandler } from '@/features/mapping/mappingExtensionRegistry'
import { extractValues, localNameOf } from './mappingSemantics'
import { createEntitySubjectResolver, createReferenceResolver, identitySourceForShape, sameRowReferences, sameRowReferenceSubject } from './entityIdentity'
import { inheritReferenceIdentifiers } from './referenceIdentifiers'

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
  if (!customized && !automatic.length) return undefined

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
  const resolveSubject = createEntitySubjectResolver(mapping, sources)
  source.rows.forEach((row, rowIdx) => {
    const subject = resolveSubject(shape, source, rowIdx)
    if (!subject) return
    let variants: unknown[][] = [[...source.headers.map((_header, index) => row[index] ?? ''), subject.value]]
    for (const reference of references) {
      const explicit = reference.explicit
      const handler = explicit ? findTransformSemanticsHandler(mappingTransformId(explicit.edge)) : undefined
      const cell = explicit ? row[source.headers.indexOf(explicit.edge.sourceHeader)] : undefined
      const valuesToResolve = cell == null || cell === '' ? []
        : handler?.buildValue ? [handler.buildValue({ edge: explicit!.edge, source, row })].filter((value): value is string => Boolean(value))
          : extractValues(cell, explicit ? mappingTransformId(explicit.edge) : undefined)
      const values = reference.explicit
        ? valuesToResolve.flatMap(value => resolveReference(reference.explicit!.target, value).map(item => item.value))
        : [sameRowReferenceSubject(reference.automatic!, source, rowIdx, resolveSubject)?.value ?? '']
      variants = variants.flatMap(variant => (values.length ? values : ['']).map(value => [...variant, value]))
    }
    for (const variant of variants) {
      rows.push(variant)
      if (source.recordIds) recordIds.push(source.recordIds[rowIdx])
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

export function entityExportSources(ap: ApplicationProfile, mapping: MappingState, sources: DataSource[]): DataSource[] {
  return ap.allNodeShapes().filter(shape => classifyShape(shape) !== 'form').flatMap(shape => {
    const ids = new Set(mapping.forShape(shape.nodeId.value).map(edge => edge.sourceId))
    return sources.filter(source => ids.has(source.id)).flatMap(source => {
      const prepared = prepareEntityExport(shape, source, ap, mapping, sources)
      return prepared ? [prepared.source] : []
    })
  })
}
