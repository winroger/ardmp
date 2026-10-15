import { namedNode, literal, type NamedNode, type Node as RdfNode } from 'rdflib'
import type { DataSource } from '@/domain/DataSource'
import type { NodeShape } from '@/domain/NodeShape'
import type { MappingEdge, MappingState } from '@/domain/Mapping'

export const INSTANCE_BASE_IRI = 'http://example.org/'
export const AIRTABLE_RECORD_ID_COLUMN = '_recordId'

export function sourcePathForExport(source: DataSource): string {
  return `sources/${sanitizeFileSegment(source.name)}.csv`
}

export function exportedHeadersForSource(source: DataSource): string[] {
  return source.recordIds ? [AIRTABLE_RECORD_ID_COLUMN, ...source.headers] : [...source.headers]
}

export function exportedRowsForSource(source: DataSource): unknown[][] {
  if (!source.recordIds) return source.rows.map(row => [...row])

  return source.rows.map((row, rowIdx) => [
    source.recordIds?.[rowIdx] ?? `${source.id}-row${rowIdx}`,
    ...row,
  ])
}

export function subjectReferenceForSource(source: DataSource): string | undefined {
  return source.recordIds ? AIRTABLE_RECORD_ID_COLUMN : source.headers[0]
}

export function localNameOf(iri: string): string {
  const idx = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'))
  return idx >= 0 ? iri.slice(idx + 1) : ''
}

export function mintInstanceIri(classIri: string | undefined, id: string, fallbackKey: string): NamedNode {
  const localName = classIri ? localNameOf(classIri) : ''
  const segment = localName || localNameOf(fallbackKey) || 'Resource'
  return namedNode(`${INSTANCE_BASE_IRI}${segment}/${encodeURIComponent(id)}`)
}

export function subjectReferenceForShape(shape: NodeShape, source: DataSource, mapping?: MappingState): string | undefined {
  const header = mapping?.subjectIdentifier(shape.nodeId.value, source.id)
  if (header && !source.headers.includes(header)) throw new Error(`Subject identifier column "${header}" is no longer available in ${source.name}.`)
  return header ?? subjectReferenceForSource(source)
}

export function identifierValue(value: unknown): string {
  return value == null || typeof value === 'object' ? '' : String(value).trim()
}

export function identifierValues(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [value]).map(identifierValue).filter(Boolean))]
}

export function subjectFor(shape: NodeShape, source: DataSource, row: unknown[], rowIdx: number, mapping?: MappingState): NamedNode | undefined {
  const header = mapping?.subjectIdentifier(shape.nodeId.value, source.id)
  if (header) subjectReferenceForShape(shape, source, mapping)
  const id = header ? identifierValue(row[source.headers.indexOf(header)])
    : source.recordIds?.[rowIdx] ?? String(row[0] ?? `${source.id}-row${rowIdx}`)
  if (header && !id) return undefined
  const classIri = (shape.targetClass ?? (shape.nodeId.termType === 'NamedNode' ? shape.nodeId : null))?.value
  return mintInstanceIri(classIri, String(id), shape.nodeId.value)
}

export function extractValues(cellValue: unknown, transform: MappingEdge['transform']): string[] {
  if (Array.isArray(cellValue)) {
    return cellValue
      .map(v => (v !== null && v !== undefined ? String(v).trim() : ''))
      .filter(Boolean)
  }

  const raw = String(cellValue)
  if (transform === 'split-comma') {
    return raw.split(',').map(s => s.trim()).filter(Boolean)
  }
  if (transform === 'trim') {
    const trimmed = raw.trim()
    return trimmed ? [trimmed] : []
  }

  return raw ? [raw] : []
}

export function buildObjects(
  cellValue: unknown,
  transform: MappingEdge['transform'],
  nodeKind: NamedNode | undefined,
  refTargetClass: NamedNode | undefined,
  datatype: NamedNode | undefined,
): RdfNode[] {
  const values = extractValues(cellValue, transform)
  return values.map(v => buildObject(v, nodeKind, refTargetClass, datatype))
}

export function buildWktPoint(latValue: unknown, lngValue: unknown): string | null {
  const lat = Number.parseFloat(String(latValue ?? '').trim())
  const lng = Number.parseFloat(String(lngValue ?? '').trim())
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return `POINT(${lng} ${lat})`
}

export function buildObject(
  value: string,
  nodeKind: NamedNode | undefined,
  refTargetClass: NamedNode | undefined,
  datatype: NamedNode | undefined,
): RdfNode {
  if (refTargetClass) {
    return mintInstanceIri(refTargetClass.value, value, refTargetClass.value)
  }

  if (expectsIri(nodeKind)) {
    return namedNode(value)
  }

  return datatype ? literal(value, datatype) : literal(value)
}

export function expectsIri(nodeKind: NamedNode | undefined): boolean {
  return nodeKind?.value === 'http://www.w3.org/ns/shacl#IRI'
}

function sanitizeFileSegment(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, '_') || 'export'
}

export function instanceTemplateForShape(shape: NodeShape, source: DataSource, mapping?: MappingState): string {
  const reference = subjectReferenceForShape(shape, source, mapping)
  if (!reference) {
    throw new Error(`Cannot derive subject template for source ${source.id} without an exported identifier column.`)
  }

  const classIri = (shape.targetClass ?? (shape.nodeId.termType === 'NamedNode' ? shape.nodeId : null))?.value
  const localName = classIri ? localNameOf(classIri) : ''
  const segment = localName || localNameOf(shape.nodeId.value) || 'Resource'
  return `${INSTANCE_BASE_IRI}${segment}/{${reference}}`
}

