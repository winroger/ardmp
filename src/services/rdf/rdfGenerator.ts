import { graph, serialize, type NamedNode, type Store } from 'rdflib'
import { RDF_TYPE } from '@/domain/rdfConstants'
import type { ApplicationProfile } from '@/domain/NodeShape'
import { classifyShape } from '@/domain/NodeShape'
import { mappingTransformId, type MappingState } from '@/domain/Mapping'
import type { DataSource } from '@/domain/DataSource'
import { buildObject, buildObjects, extractValues } from '@/services/mapping/mappingSemantics'
import { createEntitySubjectResolver, createReferenceResolver, sameRowReferences, sameRowReferenceSubject } from '@/services/mapping/entityIdentity'
import {
  resolveExplicitHybridOwnerForSource,
  isStagingSource,
  normalizeStagingTurtlePrefixes,
  registerStagingPrefixes,
  stagingColumnsForSourceWithRelations,
  stagingClassForSource,
  stagingRelationshipObjectsForValue,
  stagingSubjectForRow,
} from '@/services/mapping/stagingSemantics'
import { findTransformSemanticsHandler } from '@/features/mapping/mappingExtensionRegistry'
import { inheritReferenceIdentifiers } from '@/services/mapping/referenceIdentifiers'

export interface GeneratedGraph {
  store: Store
  subjectCount: number
  tripleCount: number
}

export function generateRdf(
  ap: ApplicationProfile,
  mapping: MappingState,
  sources: DataSource[],
): GeneratedGraph {
  const store = graph()
  ;(store as unknown as { setPrefixForURI: (p: string, u: string) => void })
    .setPrefixForURI?.('ex', 'http://example.org/')
  registerStagingPrefixes(store, sources)
  const sourceMap = new Map(sources.map(s => [s.id, s]))
  const allShapes = ap.allNodeShapes()
  mapping = inheritReferenceIdentifiers(allShapes, mapping, sources)
  const hybridOwnersBySourceId = new Map(
    sources
      .map(source => [source.id, resolveExplicitHybridOwnerForSource(source, mapping, allShapes, sources)] as const)
      .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof resolveExplicitHybridOwnerForSource>>] => Boolean(entry[1])),
  )
  const subjects = new Set<string>()
  const resolveReference = createReferenceResolver(mapping, sources)
  const resolveSubject = createEntitySubjectResolver(mapping, sources)

  for (const shape of ap.allNodeShapes()) {
    const kind = classifyShape(shape)
    if (kind === 'form') continue

    const edges = mapping.forShape(shape.nodeId.value)
    if (edges.length === 0) continue

    const edgesBySource = new Map<string, typeof edges>()
    for (const edge of edges) {
      const group = edgesBySource.get(edge.sourceId)
      if (group) group.push(edge)
      else edgesBySource.set(edge.sourceId, [edge])
    }

    for (const [sourceId, sourceEdges] of edgesBySource) {
      const source = sourceMap.get(sourceId)
      if (!source) continue
      const automaticReferences = sameRowReferences(shape, source, ap, mapping, sources)

      for (let rowIdx = 0; rowIdx < source.rows.length; rowIdx++) {
        const row = source.rows[rowIdx]
        const subject = resolveSubject(shape, source, rowIdx)
        if (!subject) continue
        subjects.add(subject.value)

        const typeNode = shape.targetClass ?? (shape.nodeId.termType === 'NamedNode' ? shape.nodeId as NamedNode : null)
        if (typeNode) store.add(subject, RDF_TYPE, typeNode)

        for (const edge of sourceEdges) {
          const ps = shape.properties.find(p => p.path?.value === edge.propertyPath)
          if (!ps?.path) continue
          const headerIdx = source.headers.indexOf(edge.sourceHeader)
          if (headerIdx < 0) continue
          const cellValue = row[headerIdx]
          if (cellValue === null || cellValue === undefined || cellValue === '') continue

          const refTargetClass = ps.node
            ? (ap.findNodeShape(ps.node.value)?.targetClass ?? ps.node)
            : undefined
          const target = ps.node ? ap.findNodeShape(ps.node.value) : undefined

          const transformHandler = findTransformSemanticsHandler(mappingTransformId(edge))
          if (transformHandler?.buildValue) {
            const transformedValue = transformHandler.buildValue({ edge, source, row })
            if (!transformedValue) continue
            const objects = target ? resolveReference(target, transformedValue)
              : [buildObject(transformedValue, ps.nodeKind, refTargetClass, ps.datatype)]
            for (const object of objects) store.add(subject, ps.path, object)
            continue
          }

          const objects = target
            ? extractValues(cellValue, mappingTransformId(edge)).flatMap(value => resolveReference(target, value))
            : buildObjects(cellValue, mappingTransformId(edge), ps.nodeKind, refTargetClass, ps.datatype)
          for (const obj of objects) store.add(subject, ps.path, obj)
        }
        for (const reference of automaticReferences) {
          const object = sameRowReferenceSubject(reference, source, rowIdx, resolveSubject)
          if (object) store.add(subject, reference.property.path!, object)
        }
      }
    }
  }

  for (const source of sources) {
    if (!isStagingSource(source)) continue

    const stagingColumns = stagingColumnsForSourceWithRelations(source, mapping, sources)
    if (stagingColumns.length === 0) continue

    const hybridOwner = hybridOwnersBySourceId.get(source.id)
    const stagingClass = hybridOwner ? undefined : stagingClassForSource(source)
    for (let rowIdx = 0; rowIdx < source.rows.length; rowIdx++) {
      const row = source.rows[rowIdx]
      const subject = hybridOwner
        ? resolveSubject(hybridOwner.representativeShape, source, rowIdx)
        : stagingSubjectForRow(source, rowIdx)
      if (!subject) continue

      subjects.add(subject.value)
      if (stagingClass) store.add(subject, RDF_TYPE, stagingClass)

      for (const column of stagingColumns) {
        const headerIdx = source.headers.indexOf(column.header)
        if (headerIdx < 0) continue
        const cellValue = row[headerIdx]
        if (cellValue === null || cellValue === undefined || cellValue === '') continue

        const relationshipObjects = stagingRelationshipObjectsForValue(column, cellValue, sources, hybridOwnersBySourceId, mapping)
        if (column.linkedTargetSourceId) {
          for (const object of relationshipObjects) store.add(subject, column.property, object)
          continue
        }

        store.add(subject, column.property, buildObject(String(cellValue), undefined, undefined, undefined))
      }
    }
  }

  return {
    store,
    subjectCount: subjects.size,
    tripleCount: (store as any).statements?.length ?? 0,
  }
}

export function serializeGraph(
  store: Store,
  format: 'text/turtle' | 'application/ld+json' | 'application/n-triples' = 'text/turtle',
): Promise<string> {
  return new Promise((resolve, reject) => {
    serialize(null, store, undefined, format, (err, str) => {
      if (err) reject(err)
      else resolve(format === 'text/turtle' ? normalizeStagingTurtlePrefixes(str ?? '') : (str ?? ''))
    })
  })
}


