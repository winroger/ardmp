import type { DataSource } from '@/domain/DataSource'
import { alignedRecordIdsForSource } from '@/services/mapping/enrichmentRuntime'
import { fetchGeoNameFeatures, type GeoNameFeature, type GeoNamesBatchProgress, type GeoNamesInputType, type GeoNamesLookupError, type GeoNamesOutputField } from '@/features/mapping/extensions/modules/nodes/geonames/client'
import { geoNamesInputKeys, geoNamesOutputRows } from './inputs'
import { isGeoNamesCoordinateInput } from './types'

export interface GeoNamesRuntimeResult {
  inputSourceId: string
  inputHeader: string
  inputLongitudeHeader?: string
  outputSourceId: string
  results: Record<string, GeoNameFeature>
  lookupErrors: GeoNamesLookupError[]
  totalCount: number
  processedCount: number
  cachedCount: number
}

export async function runGeoNamesRuntime(options: {
  nodeId: string
  username: string
  selectedOutputs: GeoNamesOutputField[]
  inputSourceId: string
  inputHeader: string
  inputLongitudeHeader?: string
  sources: DataSource[]
  inputType?: GeoNamesInputType
  forceRefresh?: boolean
  onProgress?: (progress: GeoNamesBatchProgress) => void
  addResultSource: (nodeId: string, headers: string[], rows: unknown[][], recordIds?: string[]) => string
}): Promise<GeoNamesRuntimeResult> {
  const inputType = options.inputType ?? 'id'
  const source = options.sources.find(candidate => candidate.id === options.inputSourceId)
  if (!source) throw new Error('The connected source table is no longer available.')
  const keys = geoNamesInputKeys(source, options.inputHeader, inputType, options.inputLongitudeHeader)
  const values = keys.filter(Boolean)
  if (!values.length) {
    throw new Error(isGeoNamesCoordinateInput(inputType)
      ? 'The connected source columns do not contain any coordinates.'
      : inputType === 'text'
        ? 'The connected source column does not contain any search text.'
        : 'The connected source column does not contain any GeoNames IDs.')
  }

  const batch = await fetchGeoNameFeatures(values, options.username, {
    inputType,
    forceRefresh: options.forceRefresh,
    onProgress: progress => {
      options.onProgress?.({
        processedCount: progress.processedCount,
        totalCount: progress.totalCount,
        cachedCount: progress.cachedCount,
        lookupErrors: progress.lookupErrors,
      })
    },
  })

  const outputRows = geoNamesOutputRows(keys, batch.results, options.selectedOutputs)
  const alignedRecordIds = alignedRecordIdsForSource(source)
  const outputSourceId = options.addResultSource(options.nodeId, [...options.selectedOutputs], outputRows, alignedRecordIds)

  return {
    inputSourceId: source.id,
    inputHeader: options.inputHeader,
    inputLongitudeHeader: options.inputLongitudeHeader,
    outputSourceId,
    results: batch.results,
    lookupErrors: batch.lookupErrors,
    totalCount: batch.totalCount,
    processedCount: batch.processedCount,
    cachedCount: batch.cachedCount,
  }
}
