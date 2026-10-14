import type { DataSource } from '@/domain/DataSource'
import type { GeoNameFeature, GeoNamesInputType, GeoNamesOutputField } from './client'
import { isGeoNamesCoordinateInput } from './types'

export function geoNamesInputKeys(source: DataSource, header: string, inputType: GeoNamesInputType, longitudeHeader?: string): string[] {
  const index = source.headers.indexOf(header)
  const longitudeIndex = longitudeHeader ? source.headers.indexOf(longitudeHeader) : -1
  if (index < 0 || (isGeoNamesCoordinateInput(inputType) && longitudeIndex < 0)) {
    throw new Error('The connected source column is no longer available.')
  }
  return source.rows.map(row => {
    const value = String(row[index] ?? '').trim()
    if (!isGeoNamesCoordinateInput(inputType)) return value
    const longitude = String(row[longitudeIndex] ?? '').trim()
    return value || longitude ? `${value}, ${longitude}` : ''
  })
}

export function geoNamesOutputRows(keys: string[], results: Record<string, GeoNameFeature>, outputs: GeoNamesOutputField[]): unknown[][] {
  return keys.map(key => {
    const feature = key && Object.hasOwn(results, key) ? results[key] : undefined
    return outputs.map(output => feature?.[output] ?? '')
  })
}
