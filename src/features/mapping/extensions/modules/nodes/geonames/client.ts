import localforage from 'localforage'
import Geonames from 'geonames.js'
import { isGeoNamesCoordinateInput, normalizeGeoNamesInputType } from './types'

const cache = localforage.createInstance({
  name: 'architectural-rdm-pipeline-v1',
  storeName: 'geonames-cache',
})

const inflightRequests = new Map<string, Promise<GeoNameFeature>>()

export const GEO_NAMES_OUTPUT_OPTIONS = [
  { id: 'id', name: 'ID', description: 'GeoNames identifier returned by the service' },
  { id: 'name', name: 'Name', description: 'Resolved place name' },
  { id: 'toponymName', name: 'Toponym name', description: 'Primary toponym label from GeoNames' },
  { id: 'lat', name: 'Latitude', description: 'Latitude coordinate' },
  { id: 'lng', name: 'Longitude', description: 'Longitude coordinate' },
  { id: 'countryCode', name: 'Country code', description: 'ISO country code' },
  { id: 'countryName', name: 'Country name', description: 'Country label' },
  { id: 'continentCode', name: 'Continent code', description: 'Continent code' },
  { id: 'adminName1', name: 'Admin level 1', description: 'First administrative subdivision name' },
  { id: 'adminName2', name: 'Admin level 2', description: 'Second administrative subdivision name' },
  { id: 'adminName3', name: 'Admin level 3', description: 'Third administrative subdivision name' },
  { id: 'adminCode1', name: 'Admin code 1', description: 'First administrative subdivision code' },
  { id: 'adminCode2', name: 'Admin code 2', description: 'Second administrative subdivision code' },
  { id: 'adminCode3', name: 'Admin code 3', description: 'Third administrative subdivision code' },
  { id: 'featureClass', name: 'Feature class', description: 'GeoNames feature class' },
  { id: 'featureCode', name: 'Feature code', description: 'GeoNames feature code' },
  { id: 'fcodeName', name: 'Feature label', description: 'Human-readable feature type label' },
  { id: 'population', name: 'Population', description: 'Population value' },
  { id: 'elevation', name: 'Elevation', description: 'Elevation in meters if available' },
  { id: 'dem', name: 'DEM', description: 'Digital elevation model value if available' },
  { id: 'timezoneId', name: 'Timezone', description: 'Timezone identifier if available' },
  { id: 'wikipediaURL', name: 'Wikipedia URL', description: 'Wikipedia URL if available' },
] as const

export type GeoNamesOutputField = (typeof GEO_NAMES_OUTPUT_OPTIONS)[number]['id']
export type GeoNamesInputType = 'id' | 'text' | 'coordinates'

export interface GeoNameFeature {
  id: string
  name: string
  toponymName: string
  lat: string
  lng: string
  countryCode: string
  countryName: string
  continentCode: string
  adminName1: string
  adminName2: string
  adminName3: string
  adminCode1: string
  adminCode2: string
  adminCode3: string
  featureClass: string
  featureCode: string
  fcodeName: string
  population: string
  elevation: string
  dem: string
  timezoneId: string
  wikipediaURL: string
}

interface CachedGeoNameFeature {
  feature: GeoNameFeature
  fetchedAt: string
}

interface GeoNamesJsonResponse {
  [key: string]: unknown
  geonameId?: string | number
  name?: string
  toponymName?: string
  lat?: string | number
  lng?: string | number
  countryCode?: string
  countryName?: string
  continentCode?: string
  adminName1?: string
  adminName2?: string
  adminName3?: string
  adminCode1?: string | number
  adminCode2?: string | number
  adminCode3?: string | number
  fcl?: string
  featureClass?: string
  featureCode?: string
  fcode?: string
  fcodeName?: string
  population?: string | number
  elevation?: string | number
  dem?: string | number
  wikipediaURL?: string
  timezone?: {
    timeZoneId?: string
  }
  timezoneId?: string
  status?: {
    message?: string
    value?: string | number
  }
}

interface GeoNamesSearchResponse {
  geonames?: GeoNamesJsonResponse[]
  status?: GeoNamesJsonResponse['status']
}

export interface GeoNamesLookupError {
  input: string
  message: string
}

export interface GeoNamesBatchProgress {
  processedCount: number
  totalCount: number
  cachedCount: number
  lookupErrors: GeoNamesLookupError[]
}

export interface GeoNamesBatchResult {
  results: Record<string, GeoNameFeature>
  lookupErrors: GeoNamesLookupError[]
  totalCount: number
  processedCount: number
  cachedCount: number
}

export function normalizeGeoNameFeature(response: GeoNamesJsonResponse): GeoNameFeature {
  const statusMessage = response.status?.message?.trim()
  if (statusMessage) throw new Error(statusMessage)

  const id = String(response.geonameId ?? '').trim()
  if (!id) throw new Error('GeoNames response did not include a geonameId.')

  return {
    id,
    name: String(response.name ?? '').trim(),
    toponymName: String(response.toponymName ?? '').trim(),
    lat: String(response.lat ?? '').trim(),
    lng: String(response.lng ?? '').trim(),
    countryCode: String(response.countryCode ?? '').trim(),
    countryName: String(response.countryName ?? '').trim(),
    continentCode: String(response.continentCode ?? '').trim(),
    adminName1: String(response.adminName1 ?? '').trim(),
    adminName2: String(response.adminName2 ?? '').trim(),
    adminName3: String(response.adminName3 ?? '').trim(),
    adminCode1: String(response.adminCode1 ?? '').trim(),
    adminCode2: String(response.adminCode2 ?? '').trim(),
    adminCode3: String(response.adminCode3 ?? '').trim(),
    featureClass: String(response.featureClass ?? response.fcl ?? '').trim(),
    featureCode: String(response.featureCode ?? response.fcode ?? '').trim(),
    fcodeName: String(response.fcodeName ?? '').trim(),
    population: String(response.population ?? '').trim(),
    elevation: String(response.elevation ?? '').trim(),
    dem: String(response.dem ?? '').trim(),
    timezoneId: String(response.timezone?.timeZoneId ?? response.timezoneId ?? '').trim(),
    wikipediaURL: String(response.wikipediaURL ?? '').trim(),
  }
}

function cacheKey(username: string, value: string, lang: string, inputType: GeoNamesInputType): string {
  const prefix = inputType === 'id' ? '' : inputType === 'text' ? 'search:' : 'nearby-place:'
  return `${username}:${lang}:${prefix}${value}`
}

async function fetchGeoNameFeatureInternal(value: string, username: string, lang: string, inputType: GeoNamesInputType): Promise<GeoNameFeature> {
  const geonames = Geonames({
    username,
    lan: lang,
    encoding: 'JSON',
    style: 'FULL',
  })

  if (inputType === 'text') {
    const response = await geonames.search({ q: value, maxRows: 1, style: 'FULL' }) as GeoNamesSearchResponse
    const statusMessage = response.status?.message?.trim()
    if (statusMessage) throw new Error(statusMessage)
    const match = response.geonames?.[0]
    if (!match) throw new Error(`No GeoNames match found for "${value}".`)
    return normalizeGeoNameFeature(match)
  }

  if (isGeoNamesCoordinateInput(inputType)) {
    const parts = value.split(',').map(part => part.trim())
    const lat = Number(parts[0])
    const lng = Number(parts[1])
    const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
    if (parts.length !== 2 || !parts.every(part => decimal.test(part))
      || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('Enter valid decimal coordinates: latitude from -90 to 90 and longitude from -180 to 180.')
    }
    const params = { lat, lng, maxRows: 1, style: 'FULL' }
    const response = await geonames.findNearbyPlaceName(params) as GeoNamesSearchResponse
    const statusMessage = response.status?.message?.trim()
    if (statusMessage) throw new Error(statusMessage)
    const match = response.geonames?.[0]
    if (!match) throw new Error(`No nearby GeoNames match found for "${value}".`)
    return normalizeGeoNameFeature(match)
  }

  const response = await geonames.get({ geonameId: value }) as GeoNamesJsonResponse
  return normalizeGeoNameFeature(response)
}

export async function fetchGeoNameFeature(
  geonameId: string,
  username: string,
  options?: { lang?: string; forceRefresh?: boolean; inputType?: GeoNamesInputType },
): Promise<{ feature: GeoNameFeature; fromCache: boolean }> {
  const lang = options?.lang ?? 'en'
  const inputType = normalizeGeoNamesInputType(options?.inputType)
  const key = cacheKey(username, geonameId, lang, inputType)

  if (!options?.forceRefresh) {
    const cached = await cache.getItem<CachedGeoNameFeature>(key)
    if (cached?.feature) return { feature: cached.feature, fromCache: true }
  }

  const current = inflightRequests.get(key)
  if (current) return { feature: await current, fromCache: false }

  const request = fetchGeoNameFeatureInternal(geonameId, username, lang, inputType)
  inflightRequests.set(key, request)
  try {
    const feature = await request
    await cache.setItem<CachedGeoNameFeature>(key, { feature, fetchedAt: new Date().toISOString() })
    return { feature, fromCache: false }
  } finally {
    inflightRequests.delete(key)
  }
}

export async function fetchGeoNameFeatures(
  geonameIds: string[],
  username: string,
  options?: {
    lang?: string
    forceRefresh?: boolean
    inputType?: GeoNamesInputType
    onProgress?: (progress: GeoNamesBatchProgress & { currentId: string }) => void
  },
): Promise<GeoNamesBatchResult> {
  const ids = Array.from(new Set(geonameIds.map(id => id.trim()).filter(Boolean)))
  const results: Record<string, GeoNameFeature> = Object.create(null)
  const lookupErrors: GeoNamesLookupError[] = []
  let processedCount = 0
  let cachedCount = 0

  for (const geonameId of ids) {
    try {
      const { feature, fromCache } = await fetchGeoNameFeature(geonameId, username, {
        lang: options?.lang,
        forceRefresh: options?.forceRefresh,
        inputType: options?.inputType,
      })
      results[geonameId] = feature
      if (fromCache) cachedCount += 1
    } catch (error) {
      lookupErrors.push({ input: geonameId, message: error instanceof Error ? error.message : String(error) })
    }
    processedCount += 1
    options?.onProgress?.({ processedCount, totalCount: ids.length, cachedCount, currentId: geonameId, lookupErrors: [...lookupErrors] })
  }

  return {
    results,
    lookupErrors,
    totalCount: ids.length,
    processedCount,
    cachedCount,
  }
}

export async function clearGeoNamesCache(): Promise<void> {
  await cache.clear()
}


