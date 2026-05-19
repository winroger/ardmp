import { createUploadedTabularSource, type DataSource } from '@/domain/DataSource'
import type { useDataStore } from '@/stores/dataStore'
import { parseCsvFile } from '@/features/mapping/extensions/modules/source-data/csv-file/parser'
import { detectLinkedColumns, looksLikeRecordIds } from '@/services/mapping/linkDetector'

type DataStore = ReturnType<typeof useDataStore>
const RECORD_ID_HEADER = '_recordId'

interface ParsedCsvSource {
  source: DataSource
}

function buildUploadedCsvSource(file: File, headers: string[], rows: unknown[][]): DataSource {
  const recordIdIndex = headers.indexOf(RECORD_ID_HEADER)
  const nextHeaders = recordIdIndex >= 0
    ? headers.filter((_, index) => index !== recordIdIndex)
    : headers

  const nextRows = rows.map(row =>
    recordIdIndex >= 0
      ? row.filter((_, index) => index !== recordIdIndex)
      : [...row],
  )

  const recordIds = recordIdIndex >= 0
    ? rows.map(row => String(row[recordIdIndex] ?? '').trim())
    : undefined

  return createUploadedTabularSource({
    id: file.name,
    name: file.name,
    headers: nextHeaders,
    rows: nextRows,
    recordIds,
    filename: file.name,
    mediaType: 'text/csv',
  })
}

function normalizeLinkedRecordColumns(source: DataSource, allSources: DataSource[]): DataSource {
  const linkedColumns = detectLinkedColumns(source, allSources)
  if (linkedColumns.length === 0) return source

  const linkedHeaders = new Set(linkedColumns.map(column => column.header))
  const rows = source.rows.map(row =>
    row.map((value, index) => {
      const header = source.headers[index]
      if (!linkedHeaders.has(header)) return value
      if (Array.isArray(value)) return value
      if (!looksLikeRecordIds(value)) return value
      return String(value).split(',').map(part => part.trim()).filter(Boolean)
    }),
  )

  return createUploadedTabularSource({
    id: source.id,
    name: source.name,
    headers: [...source.headers],
    rows,
    recordIds: source.recordIds ? [...source.recordIds] : undefined,
    filename: source.origin.kind === 'uploaded-file' ? source.origin.filename : source.name,
    mediaType: source.origin.kind === 'uploaded-file' ? source.origin.mediaType : 'text/csv',
  })
}

export async function importCsvFiles(dataStore: DataStore, files: File[]): Promise<void> {
  const importedSources: ParsedCsvSource[] = []

  for (const file of files) {
    const { headers, rows } = await parseCsvFile(file)
    importedSources.push({
      source: buildUploadedCsvSource(file, headers, rows),
    })
  }

  const allSources = [
    ...dataStore.sources,
    ...importedSources.map(entry => entry.source),
  ]

  for (const entry of importedSources) {
    dataStore.upsertSource(normalizeLinkedRecordColumns(entry.source, allSources))
  }
}
