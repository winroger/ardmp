import type { ExploreDataframeColumnSnapshot } from '@/services/project/projectSnapshot'

export const GEO_WKT_LITERAL_IRI = 'http://www.opengis.net/ont/geosparql#wktLiteral'
export const XSD_YEAR_IRI = 'http://www.w3.org/2001/XMLSchema#year'
export const NUMERIC_DATATYPE_IRIS = new Set([
  'http://www.w3.org/2001/XMLSchema#decimal',
  'http://www.w3.org/2001/XMLSchema#double',
  'http://www.w3.org/2001/XMLSchema#float',
  'http://www.w3.org/2001/XMLSchema#integer',
  'http://www.w3.org/2001/XMLSchema#int',
  'http://www.w3.org/2001/XMLSchema#long',
  'http://www.w3.org/2001/XMLSchema#nonNegativeInteger',
  'http://www.w3.org/2001/XMLSchema#positiveInteger',
])

export interface ParsedWktPoint {
  lng: number
  lat: number
}

export function stringValue(value: string | number | null | undefined, fallback = 'Unassigned'): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

export function numericValue(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function fieldLabel(
  fields: readonly ExploreDataframeColumnSnapshot[],
  key: string | undefined,
  fallback: string,
): string {
  if (!key) return fallback
  return fields.find(field => field.id === key)?.label ?? fallback
}

export function fieldDatatype(
  fields: readonly ExploreDataframeColumnSnapshot[],
  key: string | undefined,
): string | undefined {
  if (!key) return undefined
  return fields.find(field => field.id === key)?.datatype
}

export function isWktField(fields: readonly ExploreDataframeColumnSnapshot[], key: string | undefined): boolean {
  if (!key) return false
  return fields.some(field => field.id === key && (field.datatype === GEO_WKT_LITERAL_IRI || /wkt/i.test(field.label)))
}

export function parseWktPoint(value: string | number | null | undefined): ParsedWktPoint | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
    .replace(/^SRID=\d+;/i, '')
    .replace(/^<[^>]+>\s*/i, '')

  const match = normalized.match(/^POINT(?:\s+(?:Z|M|ZM))?\s*\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)(?:\s+[^)]*)?\s*\)$/i)
  if (!match) return null

  const lng = Number(match[1])
  const lat = Number(match[2])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null

  return { lng, lat }
}