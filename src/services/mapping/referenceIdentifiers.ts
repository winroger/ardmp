import { MappingState, mappingTransformId, type SubjectIdentifierMapping } from '@/domain/Mapping'
import type { DataSource } from '@/domain/DataSource'
import type { NodeShape, PropertyShape } from '@/domain/NodeShape'
import { sourceRoot } from './entityIdentity'

export interface ReferenceIdentifier extends SubjectIdentifierMapping {
  fromShape: NodeShape
  property: PropertyShape
}

/** Incoming same-row references define the identity of the referenced profile. */
export function referenceIdentifiers(shapes: readonly NodeShape[], mapping: MappingState, sources: readonly DataSource[]): ReferenceIdentifier[] {
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  const shapeMap = new Map(shapes.map(shape => [shape.nodeId.value, shape]))
  const identifiers = new Map<string, ReferenceIdentifier>()
  for (const edge of mapping.edges) {
    const fromShape = shapeMap.get(edge.shapeIri)
    const property = fromShape?.properties.find(item => item.path?.value === edge.propertyPath)
    const source = sourceMap.get(edge.sourceId)
    if (!fromShape || !property?.node || !shapeMap.has(property.node.value) || !source) continue
    if (property.node.value === fromShape.nodeId.value) continue
    const transform = mappingTransformId(edge)
    if (transform && transform !== 'trim') continue
    const targetSources = mapping.forShape(property.node.value).flatMap(item => sourceMap.get(item.sourceId) ?? [])
    const root = sourceRoot(source, sources)
    // Across independent tables this is a foreign key, not the target's primary column.
    if (targetSources.length && !targetSources.some(item => sourceRoot(item, sources) === root)) continue
    identifiers.set(JSON.stringify([property.node.value, root]), {
      shapeIri: property.node.value, sourceId: source.id, header: edge.sourceHeader, fromShape, property,
    })
  }
  return [...identifiers.values()]
}

/** Derive an effective mapping without persisting a second, competing selection. */
export function inheritReferenceIdentifiers(shapes: readonly NodeShape[], mapping: MappingState, sources: readonly DataSource[]): MappingState {
  const inherited = referenceIdentifiers(shapes, mapping, sources)
  if (!inherited.length) return mapping
  const rootForId = (sourceId: string) => {
    const source = sources.find(item => item.id === sourceId)
    return source ? sourceRoot(source, sources) : sourceId
  }
  const state = new MappingState()
  state.edges = mapping.edges
  state.stagingColumns = mapping.stagingColumns
  state.subjectIdentifiers = [
    ...mapping.subjectIdentifiers.filter(item => !inherited.some(identifier =>
      identifier.shapeIri === item.shapeIri && rootForId(identifier.sourceId) === rootForId(item.sourceId),
    )),
    ...inherited.map(({ shapeIri, sourceId, header }) => ({ shapeIri, sourceId, header })),
  ]
  return state
}
