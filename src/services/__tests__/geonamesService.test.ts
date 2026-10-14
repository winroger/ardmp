import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import localforage from 'localforage'

const getMock = vi.fn()
const searchMock = vi.fn()
const nearbyMock = vi.fn()
const nearbyPlaceMock = vi.fn()

vi.mock('geonames.js', () => ({
  default: vi.fn(() => ({
    get: getMock,
    search: searchMock,
    findNearby: nearbyMock,
    findNearbyPlaceName: nearbyPlaceMock,
  })),
}))

vi.mock('localforage', () => {
  const stores = new Map<string, Map<string, unknown>>()
  return {
    default: {
      createInstance: ({ storeName }: { storeName: string }) => {
        const store = stores.get(storeName) ?? new Map<string, unknown>()
        stores.set(storeName, store)
        return {
          async getItem<T>(key: string): Promise<T | null> { return (store.get(key) as T | undefined) ?? null },
          async setItem<T>(key: string, value: T): Promise<T> { store.set(key, value); return value },
          async clear(): Promise<void> { store.clear() },
        }
      },
    },
  }
})

import { clearGeoNamesCache, fetchGeoNameFeature, fetchGeoNameFeatures, normalizeGeoNameFeature } from '@/features/mapping/extensions/modules/nodes/geonames/client'

const SAMPLE_JSON = {
  geonameId: 6173331,
  name: 'Vancouver',
  lat: 49.24966,
  lng: -123.11934,
}

describe('geonamesService', () => {
  beforeEach(async () => {
    await clearGeoNamesCache()
    getMock.mockReset()
    searchMock.mockReset()
    nearbyMock.mockReset()
    nearbyPlaceMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes the GeoNames JSON payload', () => {
    expect(normalizeGeoNameFeature(SAMPLE_JSON)).toEqual({
      id: '6173331',
      name: 'Vancouver',
      toponymName: '',
      lat: '49.24966',
      lng: '-123.11934',
      countryCode: '',
      countryName: '',
      continentCode: '',
      adminName1: '',
      adminName2: '',
      adminName3: '',
      adminCode1: '',
      adminCode2: '',
      adminCode3: '',
      featureClass: '',
      featureCode: '',
      fcodeName: '',
      population: '',
      elevation: '',
      dem: '',
      timezoneId: '',
      wikipediaURL: '',
    })
  })

  it('reuses cached values for repeated requests', async () => {
    getMock.mockResolvedValue(SAMPLE_JSON)

    const first = await fetchGeoNameFeature('6173331', 'demo')
    const second = await fetchGeoNameFeature('6173331', 'demo')

    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(true)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('reports cached items in batch mode', async () => {
    getMock.mockResolvedValue(SAMPLE_JSON)

    await fetchGeoNameFeature('6173331', 'demo')
    const batch = await fetchGeoNameFeatures(['6173331', '6173331'], 'demo')

    expect(batch.totalCount).toBe(1)
    expect(batch.cachedCount).toBe(1)
    expect(batch.processedCount).toBe(1)
    expect(batch.results['6173331']?.name).toBe('Vancouver')
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('searches free text and caches the first result by the original query', async () => {
    searchMock.mockResolvedValue({ geonames: [SAMPLE_JSON, { geonameId: 123, name: 'Other place' }] })
    const onProgress = vi.fn()

    const first = await fetchGeoNameFeatures([' Vancouver Canada ', 'Vancouver Canada'], 'demo', { inputType: 'text', onProgress })
    const second = await fetchGeoNameFeatures(['Vancouver Canada'], 'demo', { inputType: 'text' })

    expect(first.results['Vancouver Canada']).toMatchObject({ id: '6173331', name: 'Vancouver' })
    expect(first).toMatchObject({ totalCount: 1, processedCount: 1, cachedCount: 0 })
    expect(second.cachedCount).toBe(1)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith({ q: 'Vancouver Canada', maxRows: 1, style: 'FULL' })
    expect(getMock).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith({ processedCount: 1, totalCount: 1, cachedCount: 0, currentId: 'Vancouver Canada', lookupErrors: [] })
  })

  it('keeps numeric text searches separate from ID lookups and supports refreshing searches', async () => {
    getMock.mockResolvedValue(SAMPLE_JSON)
    searchMock.mockResolvedValue({ geonames: [{ geonameId: 123, name: 'Search result' }] })

    const byId = await fetchGeoNameFeature('6173331', 'demo')
    const byText = await fetchGeoNameFeature('6173331', 'demo', { inputType: 'text' })
    const refreshed = await fetchGeoNameFeature('6173331', 'demo', { inputType: 'text', forceRefresh: true })

    expect(byId.feature.id).toBe('6173331')
    expect(byText.feature.id).toBe('123')
    expect(refreshed.fromCache).toBe(false)
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('identifies unmatched text and allows retrying after a failed search', async () => {
    searchMock.mockResolvedValueOnce({ geonames: [] }).mockResolvedValueOnce({ geonames: [SAMPLE_JSON] })

    await expect(fetchGeoNameFeature('Unknown place', 'demo', { inputType: 'text' }))
      .rejects.toThrow('No GeoNames match found for "Unknown place".')
    await expect(fetchGeoNameFeature('Unknown place', 'demo', { inputType: 'text' }))
      .resolves.toMatchObject({ feature: { id: '6173331' }, fromCache: false })
  })

  it('reports GeoNames service errors from searches', async () => {
    searchMock.mockResolvedValue({ status: { message: 'Daily limit exceeded', value: 18 } })

    await expect(fetchGeoNameFeature('Vancouver', 'demo', { inputType: 'text' }))
      .rejects.toThrow('Daily limit exceeded')
  })

  it.each(['id', 'text'] as const)('continues after failed %s lookups and counts all attempts', async inputType => {
    getMock.mockImplementation(async ({ geonameId }: { geonameId: string }) => {
      if (geonameId === 'missing') return { status: { message: 'Unknown geonameId' } }
      if (geonameId === 'offline') throw new Error('Network error')
      return SAMPLE_JSON
    })
    searchMock.mockImplementation(async ({ q }: { q: string }) => {
      if (q === 'missing') return { geonames: [] }
      if (q === 'offline') throw new Error('Network error')
      return { geonames: [SAMPLE_JSON] }
    })
    await fetchGeoNameFeature('cached', 'demo', { inputType })
    const onProgress = vi.fn()

    const batch = await fetchGeoNameFeatures(['cached', 'missing', 'missing', 'offline', 'next'], 'demo', { inputType, onProgress })

    expect(Object.keys(batch.results)).toEqual(['cached', 'next'])
    expect(batch.lookupErrors).toEqual([
      { input: 'missing', message: inputType === 'id' ? 'Unknown geonameId' : 'No GeoNames match found for "missing".' },
      { input: 'offline', message: 'Network error' },
    ])
    expect(batch).toMatchObject({ totalCount: 4, processedCount: 4, cachedCount: 1 })
    expect(onProgress.mock.calls.map(([progress]) => progress.processedCount)).toEqual([1, 2, 3, 4])
    expect(onProgress.mock.calls[0]![0].lookupErrors).toEqual([])
    expect(onProgress.mock.calls[3]![0].lookupErrors).toEqual(batch.lookupErrors)

    getMock.mockResolvedValue(SAMPLE_JSON)
    searchMock.mockResolvedValue({ geonames: [SAMPLE_JSON] })
    const retry = await fetchGeoNameFeatures(['cached', 'missing', 'next'], 'demo', { inputType })
    expect(retry.lookupErrors).toEqual([])
    expect(retry.cachedCount).toBe(2)
    expect(Object.keys(retry.results)).toEqual(['cached', 'missing', 'next'])
  })

  it('returns an empty result table and diagnostics when every lookup fails', async () => {
    searchMock.mockResolvedValue({ geonames: [] })

    const batch = await fetchGeoNameFeatures(['Unknown', 'constructor'], 'demo', { inputType: 'text' })

    expect(Object.keys(batch.results)).toEqual([])
    expect(batch.lookupErrors).toHaveLength(2)
    expect(batch).toMatchObject({ totalCount: 2, processedCount: 2, cachedCount: 0 })
  })

  it('resolves coordinate pairs with one populated-place request and caches the result', async () => {
    nearbyPlaceMock.mockResolvedValue({ geonames: [SAMPLE_JSON] })

    const first = await fetchGeoNameFeature('49.24966, -123.11934', 'demo', { inputType: 'coordinates' })
    const second = await fetchGeoNameFeature('49.24966, -123.11934', 'demo', { inputType: 'coordinates' })

    expect(first).toMatchObject({ feature: { id: '6173331', name: 'Vancouver' }, fromCache: false })
    expect(second.fromCache).toBe(true)
    expect(nearbyPlaceMock).toHaveBeenCalledTimes(1)
    expect(nearbyPlaceMock).toHaveBeenCalledWith({ lat: 49.24966, lng: -123.11934, maxRows: 1, style: 'FULL' })
    expect(nearbyMock).not.toHaveBeenCalled()
    expect(getMock).not.toHaveBeenCalled()
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('ignores old nearest-feature cached values and accepts zero coordinates', async () => {
    const storedCache = localforage.createInstance({ storeName: 'geonames-cache' })
    await storedCache.setItem('demo:en:coordinates:0, 0', { feature: normalizeGeoNameFeature(SAMPLE_JSON) })
    nearbyPlaceMock.mockResolvedValue({ geonames: [{ ...SAMPLE_JSON, geonameId: 123 }] })

    const place = await fetchGeoNameFeature('0, 0', 'demo', { inputType: 'coordinates' })
    const cached = await fetchGeoNameFeature('0, 0', 'demo', { inputType: 'coordinates' })

    expect(place.feature.id).toBe('123')
    expect(cached.fromCache).toBe(true)
    expect(nearbyPlaceMock).toHaveBeenCalledTimes(1)
    expect(nearbyPlaceMock).toHaveBeenCalledWith({ lat: 0, lng: 0, maxRows: 1, style: 'FULL' })
  })

  it('leaves invalid coordinate pairs and unmatched points unresolved while continuing the batch', async () => {
    nearbyPlaceMock.mockImplementation(async ({ lat }: { lat: number }) => lat === 1 ? { geonames: [] } : { geonames: [SAMPLE_JSON] })
    const values = ['91, 0', '0, 181', 'abc, 1', ', 1', '1, ', '0x10, 3', 'Infinity, 2', '1, 2, 3', '1, 2', '49, -123']

    const batch = await fetchGeoNameFeatures(values, 'demo', { inputType: 'coordinates' })

    expect(batch).toMatchObject({ totalCount: 10, processedCount: 10 })
    expect(batch.lookupErrors).toHaveLength(9)
    expect(batch.lookupErrors[8]?.message).toContain('No nearby GeoNames match')
    expect(Object.keys(batch.results)).toEqual(['49, -123'])
    expect(nearbyPlaceMock).toHaveBeenCalledTimes(2)
  })
})


