import type { NamedNode } from 'rdflib'
import type { MappingState } from '@/domain/Mapping'
import type { DataSource } from '@/domain/DataSource'
import type { ApplicationProfile, NodeShape, PropertyShape } from '@/domain/NodeShape'
import { classifyShape } from '@/domain/NodeShape'
import { identifierValue, mintInstanceIri, subjectFor, subjectReferenceForShape } from './mappingSemantics'

export interface SameRowReference {
  property: PropertyShape
  target: NodeShape
  source: DataSource
}

export function sourceRoot(source: DataSource, sources: readonly DataSource[]): string {
  const visited = new Set<string>()
  let current = source
  while (current.origin.kind === 'node-output' && current.origin.inputSourceId && !visited.has(current.id)) {
    visited.add(current.id)
    const parentId = current.origin.inputSourceId
    const parent = sources.find(item => item.id === parentId)
    if (!parent) return parentId
    current = parent
  }
  return current.id
}

/** A shape has one identity within an original table and all its derived outputs. */
export function identitySourceForShape(shape: NodeShape, source: DataSource, mapping: MappingState, sources: readonly DataSource[]): DataSource {
  const root = sourceRoot(source, sources)
  const related = sources.filter(item => sourceRoot(item, sources) === root)
  // The latest selection also handles projects saved with separate per-output settings.
  const selected = [...mapping.subjectIdentifiers].reverse().find(item =>
    item.shapeIri === shape.nodeId.value && related.some(candidate => candidate.id === item.sourceId),
  )
  return related.find(item => item.id === selected?.sourceId)
    ?? related.find(item => item.id === root)
    ?? source
}

export type EntitySubjectResolver = (shape: NodeShape, source: DataSource, rowIdx: number) => NamedNode | undefined

export function createEntitySubjectResolver(mapping: MappingState, sources: DataSource[]): EntitySubjectResolver {
  const identities = new Map<string, DataSource>()
  const rowIndexes = new Map<string, Map<string, number[]>>()
  return (shape, source, rowIdx) => {
    const cacheKey = JSON.stringify([shape.nodeId.value, source.id])
    let identity = identities.get(cacheKey)
    if (!identity) {
      identity = identitySourceForShape(shape, source, mapping, sources)
      identities.set(cacheKey, identity)
      subjectReferenceForShape(shape, identity, mapping)
    }
    let identityRowIdx = rowIdx
    if (identity.id !== source.id) {
      const key = rowKey(source, rowIdx)
      if (identity.rows.length !== source.rows.length || rowKey(identity, rowIdx) !== key) {
        let index = rowIndexes.get(identity.id)
        if (!index) {
          index = new Map()
          identity.rows.forEach((_row, idx) => {
            const rowId = rowKey(identity!, idx)
            index!.set(rowId, [...(index!.get(rowId) ?? []), idx])
          })
          rowIndexes.set(identity.id, index)
        }
        const matches = index.get(key)
        if (matches?.length !== 1) return undefined
        identityRowIdx = matches[0]
      }
    }
    const row = identity.rows[identityRowIdx]
    return row ? subjectFor(shape, identity, row, identityRowIdx, mapping) : undefined
  }
}

export function sameRowReferences(shape: NodeShape, source: DataSource, ap: ApplicationProfile, mapping: MappingState, sources: DataSource[]): SameRowReference[] {
  return shape.properties.flatMap(property => {
    if (!property.node || !property.path || mapping.forProperty(shape.nodeId.value, property.path.value)) return []
    const target = ap.findNodeShape(property.node.value)
    if (!target || classifyShape(target) === 'form') return []
    const ids = new Set(mapping.forShape(target.nodeId.value).map(edge => edge.sourceId))
    const candidates = sources.filter(item => ids.has(item.id))
    const exact = candidates.find(item => item.id === source.id)
    const related = exact ? [exact] : candidates.filter(item => sourceRoot(item, sources) === sourceRoot(source, sources))
    // Related outputs contribute to the same target entity, using its chosen identity.
    return related.length ? [{ property, target, source: identitySourceForShape(target, related[0], mapping, sources) }] : []
  })
}

function rowKey(source: DataSource, rowIdx: number): string {
  return String(source.recordIds?.[rowIdx] ?? source.rows[rowIdx]?.[0] ?? `${source.id}-row${rowIdx}`)
}

export function sameRowReferenceSubject(reference: SameRowReference, source: DataSource, rowIdx: number, resolveSubject: EntitySubjectResolver): NamedNode | undefined {
  let targetRowIdx = rowIdx
  if (reference.source.id !== source.id) {
    const key = rowKey(source, rowIdx)
    if (reference.source.rows.length !== source.rows.length || rowKey(reference.source, rowIdx) !== key) {
      const matches = reference.source.rows.flatMap((_row, index) => rowKey(reference.source, index) === key ? [index] : [])
      if (matches.length !== 1) return undefined
      targetRowIdx = matches[0]
    }
  }
  const row = reference.source.rows[targetRowIdx]
  return row ? resolveSubject(reference.target, reference.source, targetRowIdx) : undefined
}

export function createReferenceResolver(mapping: MappingState, sources: DataSource[]) {
  const indexes = new Map<string, { identifiers: Map<string, NamedNode[]>; records: Map<string, NamedNode[]> }>()
  const resolveSubject = createEntitySubjectResolver(mapping, sources)
  return (target: NodeShape, value: string): NamedNode[] => {
    let lookup = indexes.get(target.nodeId.value)
    if (!lookup) {
      lookup = { identifiers: new Map(), records: new Map() }
      const targetSources = sources.filter(source => mapping.forShape(target.nodeId.value).some(edge => edge.sourceId === source.id))
      const ids = new Set(targetSources.flatMap(source => [source.id, identitySourceForShape(target, source, mapping, sources).id]))
      for (const source of sources.filter(item => ids.has(item.id))) {
        const header = mapping.subjectIdentifier(target.nodeId.value, source.id)
        source.rows.forEach((row, index) => {
          const record = identifierValue(source.recordIds?.[index] ?? row[0])
          const identifier = header ? identifierValue(row[source.headers.indexOf(header)]) : record
          const subject = resolveSubject(target, source, index)
          for (const [key, values] of [[identifier, lookup!.identifiers], [record, lookup!.records]] as const) {
            if (!key) continue
            const subjects = values.get(key) ?? []
            if (subject) subjects.push(subject)
            values.set(key, subjects)
          }
        })
      }
      indexes.set(target.nodeId.value, lookup)
    }
    const key = identifierValue(value)
    const subjects = lookup.identifiers.get(key) ?? lookup.records.get(key)
    if (subjects) return [...new Map(subjects.map(subject => [subject.value, subject])).values()]
    const customized = mapping.subjectIdentifiers.some(item => item.shapeIri === target.nodeId.value)
    if (customized && !key) return []
    return [mintInstanceIri(target.targetClass?.value, customized ? key : value, target.nodeId.value)]
  }
}
