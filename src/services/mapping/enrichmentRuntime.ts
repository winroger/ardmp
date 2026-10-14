import type { DataSource } from '@/domain/DataSource'

export interface ConnectedSourceColumn {
  source: DataSource
  sourceId: string
  sourceHeader: string
  headerIndex: number
  values: string[]
}

export function resolveConnectedSourceColumn(
  sources: DataSource[],
  sourceId: string,
  sourceHeader: string,
  emptyValuesMessage: string,
): ConnectedSourceColumn {
  const source = sources.find(candidate => candidate.id === sourceId)
  if (!source) throw new Error('The connected source table is no longer available.')

  const headerIndex = source.headers.indexOf(sourceHeader)
  if (headerIndex < 0) throw new Error('The connected source column is no longer available.')

  const values = source.rows.map(row => String(row[headerIndex] ?? '').trim()).filter(Boolean)
  if (values.length === 0) throw new Error(emptyValuesMessage)

  return {
    source,
    sourceId,
    sourceHeader,
    headerIndex,
    values,
  }
}

export function alignedRecordIdsForSource(source: DataSource): string[] {
  return source.recordIds ?? source.rows.map((row, rowIdx) => String(row[0] ?? `${source.id}-row${rowIdx}`))
}

export function buildEnrichmentOutputRows<ResultRecord>(
  source: DataSource,
  headerIndex: number,
  results: Record<string, ResultRecord>,
  fields: string[],
  readField: (record: ResultRecord | undefined, field: string) => string,
): unknown[][] {
  return source.rows.map(row => {
    const recordId = String(row[headerIndex] ?? '').trim()
    const record = recordId && Object.hasOwn(results, recordId) ? results[recordId] : undefined
    return fields.map(field => readField(record, field))
  })
}

export function materializeEnrichmentOutputSource<ResultRecord>(options: {
  source: DataSource
  inputHeader: string
  results: Record<string, ResultRecord>
  fields: string[]
  readField: (record: ResultRecord | undefined, field: string) => string
  addResultSource: (headers: string[], rows: unknown[][], recordIds: string[]) => string
}): string | undefined {
  const headerIndex = options.source.headers.indexOf(options.inputHeader)
  if (headerIndex < 0) return undefined

  const outputRows = buildEnrichmentOutputRows(
    options.source,
    headerIndex,
    options.results,
    options.fields,
    options.readField,
  )
  const alignedRecordIds = alignedRecordIdsForSource(options.source)

  return options.addResultSource([...options.fields], outputRows, alignedRecordIds)
}


