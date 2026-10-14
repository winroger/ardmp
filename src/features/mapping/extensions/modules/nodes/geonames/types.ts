import type { ExtensionUiEdge, NodeRunStats } from '@/features/mapping/extensions/core/types'
import type { GeoNameFeature, GeoNamesInputType, GeoNamesLookupError, GeoNamesOutputField } from '@/features/mapping/extensions/modules/nodes/geonames/client'

export const GEONAMES_INPUT_OPTIONS = [
  {
    inputType: 'id', label: 'GeoNames ID',
    description: 'Look up a place by its numeric GeoNames ID.',
    inputs: [{ id: 'geo-input', label: 'GeoNames ID' }],
  },
  {
    inputType: 'text', label: 'Free text',
    description: 'Use the first GeoNames search result. Include a country or region for a more specific search.',
    inputs: [{ id: 'geo-text-input', label: 'Free text' }],
  },
  {
    inputType: 'coordinates', label: 'Latitude / longitude',
    description: 'Find the nearest city or populated place from latitude and longitude in decimal degrees.',
    inputs: [{ id: 'geo-lat-input', label: 'Latitude' }, { id: 'geo-lng-input', label: 'Longitude' }],
  },
] as const

export const GEONAMES_DEFAULT_OUTPUTS = ['name', 'id', 'lat', 'lng', 'countryName'] as const satisfies readonly GeoNamesOutputField[]

export function normalizeGeoNamesInputType(inputType: string | undefined): GeoNamesInputType {
  if (inputType === 'coordinates' || inputType === 'nearby-place') return 'coordinates'
  return inputType === 'text' ? 'text' : 'id'
}

export function isGeoNamesCoordinateInput(inputType: GeoNamesInputType): boolean {
  return inputType === 'coordinates'
}

export function geoNamesInputOption(inputType: GeoNamesInputType) {
  return GEONAMES_INPUT_OPTIONS.find(option => option.inputType === inputType)!
}

export interface GeoNamesNodeConfig {
  id: string
  username: string
  selectedOutputs: GeoNamesOutputField[]
  inputSourceId?: string
  inputHeader?: string
  inputType?: GeoNamesInputType
  inputMode?: GeoNamesInputType
  inputLongitudeHeader?: string
  outputSourceId?: string
  status: 'idle' | 'running' | 'success' | 'error'
  stats: NodeRunStats
  results: Record<string, GeoNameFeature>
  lookupErrors?: GeoNamesLookupError[]
}

export type GeoNamesUiEdge = ExtensionUiEdge

