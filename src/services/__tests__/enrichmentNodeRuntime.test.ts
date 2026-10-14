import { describe, expect, it, vi } from 'vitest'
import type { DataSource } from '@/domain/DataSource'
import { csvSource } from '@/test/dataSources'
import { runGeoNamesRuntime } from '@/features/mapping/extensions/modules/nodes/geonames/runtime'
import { fetchGeoNameFeatures } from '@/features/mapping/extensions/modules/nodes/geonames/client'
import { runLobidRuntime } from '@/features/mapping/extensions/modules/nodes/lobid/runtime'

vi.mock('@/features/mapping/extensions/modules/nodes/geonames/client', () => ({
  fetchGeoNameFeatures: vi.fn(async (ids: string[]) => ({
    results: Object.fromEntries(ids.map(id => [id, {
      id,
      name: `Geo ${id}`,
      toponymName: `Geo ${id}`,
      lat: '1',
      lng: '2',
      countryCode: 'CA',
      countryName: 'Canada',
      continentCode: 'NA',
      adminName1: '',
      adminName2: '',
      adminName3: '',
      adminCode1: '',
      adminCode2: '',
      adminCode3: '',
      featureClass: 'P',
      featureCode: 'PPL',
      fcodeName: 'populated place',
      population: '1000',
      elevation: '',
      dem: '',
      timezoneId: '',
      wikipediaURL: '',
    }])) ,
    totalCount: ids.length,
    lookupErrors: [],
    processedCount: ids.length,
    cachedCount: 0,
  })),
}))

vi.mock('@/features/mapping/extensions/modules/nodes/lobid/client', () => ({
  fetchLobidBatch: vi.fn(async (ids: string[], properties: string[]) => ({
    results: Object.fromEntries(ids.map(id => [id, Object.fromEntries(properties.map(property => [property, `${property}:${id}`]))])),
    totalCount: ids.length,
    processedCount: ids.length,
    cachedCount: 0,
  })),
}))

describe('enrichmentNodeRuntime', () => {
  const sources = [
    csvSource('cities', 'Cities', ['geoId'], [['6173331'], ['5128581']]),
  ] satisfies DataSource[]

  it('runs GeoNames enrichment and materializes output rows', async () => {
    const addResultSource = vi.fn(() => 'geonames-output:node-1')

    const result = await runGeoNamesRuntime({
      nodeId: 'geonames:node-1',
      username: 'demo-user',
      selectedOutputs: ['name', 'id'],
      inputSourceId: 'cities',
      inputHeader: 'geoId',
      sources,
      addResultSource,
    })

    expect(result).toMatchObject({
      inputSourceId: 'cities',
      inputHeader: 'geoId',
      outputSourceId: 'geonames-output:node-1',
      processedCount: 2,
    })
    expect(addResultSource).toHaveBeenCalledWith(
      'geonames:node-1',
      ['name', 'id'],
      [['Geo 6173331', '6173331'], ['Geo 5128581', '5128581']],
      ['6173331', '5128581'],
    )
  })

  it('runs Lobid enrichment and materializes output rows', async () => {
    const addResultSource = vi.fn(() => 'lobid-output:node-1')

    const result = await runLobidRuntime({
      nodeId: 'lobid:node-1',
      selectedProperties: ['preferredName'],
      inputSourceId: 'cities',
      inputHeader: 'geoId',
      sources,
      addResultSource,
    })

    expect(result).toMatchObject({
      inputSourceId: 'cities',
      inputHeader: 'geoId',
      outputSourceId: 'lobid-output:node-1',
      processedCount: 2,
    })
    expect(addResultSource).toHaveBeenCalledWith(
      'lobid:node-1',
      ['preferredName'],
      [['preferredName:6173331'], ['preferredName:5128581']],
      ['6173331', '5128581'],
    )
  })

  it('preserves row order, blank rows and record IDs for free text enrichment', async () => {
    const source = { ...csvSource('places', 'Places', ['place'], [[' Vancouver '], [''], ['Berlin'], ['Vancouver']]),
      recordIds: ['row-a', 'row-b', 'row-c', 'row-d'] }
    const addResultSource = vi.fn(() => 'geonames-output:text')

    await runGeoNamesRuntime({
      nodeId: 'geonames:text',
      username: 'demo-user',
      selectedOutputs: ['name'],
      inputSourceId: 'places',
      inputHeader: 'place',
      inputType: 'text',
      sources: [source],
      addResultSource,
    })

    expect(fetchGeoNameFeatures).toHaveBeenLastCalledWith(['Vancouver', 'Berlin', 'Vancouver'], 'demo-user', expect.objectContaining({ inputType: 'text' }))
    expect(addResultSource).toHaveBeenCalledWith('geonames:text', ['name'],
      [['Geo Vancouver'], [''], ['Geo Berlin'], ['Geo Vancouver']], source.recordIds)
  })

  it('rejects an empty free text column before creating output', async () => {
    const addResultSource = vi.fn()

    await expect(runGeoNamesRuntime({
      nodeId: 'geonames:text',
      username: 'demo-user',
      selectedOutputs: ['name'],
      inputSourceId: 'places',
      inputHeader: 'place',
      inputType: 'text',
      sources: [csvSource('places', 'Places', ['place'], [[' '], ['']])],
      addResultSource,
    })).rejects.toThrow('The connected source column does not contain any search text.')
    expect(addResultSource).not.toHaveBeenCalled()
  })

  it('leaves repeated failed locations empty and preserves successful and blank rows', async () => {
    const sample = await fetchGeoNameFeatures(['good', 'next'], 'demo')
    const lookupErrors = [{ input: 'constructor', message: 'No match' }]
    vi.mocked(fetchGeoNameFeatures).mockResolvedValueOnce({ ...sample, totalCount: 3, processedCount: 3, lookupErrors })
    const source = csvSource('places', 'Places', ['place'], [['good'], ['constructor'], [''], ['constructor'], ['next']], ['a', 'b', 'c', 'd', 'e'])
    const addResultSource = vi.fn(() => 'geonames-output:mixed')

    const result = await runGeoNamesRuntime({
      nodeId: 'geonames:mixed', username: 'demo', selectedOutputs: ['name', 'id'], inputSourceId: source.id,
      inputHeader: 'place', inputType: 'text', sources: [source], addResultSource,
    })

    expect(result.lookupErrors).toEqual(lookupErrors)
    expect(addResultSource).toHaveBeenCalledWith('geonames:mixed', ['name', 'id'],
      [['Geo good', 'good'], ['', ''], ['', ''], ['', ''], ['Geo next', 'next']], source.recordIds)
  })

  it('combines coordinate columns per row without shifting duplicates, missing values or zero coordinates', async () => {
    const sample = await fetchGeoNameFeatures(['49, -123', '0, 0'], 'demo')
    const lookupErrors = [{ input: ', 1', message: 'Missing latitude' }]
    vi.mocked(fetchGeoNameFeatures).mockResolvedValueOnce({ ...sample, totalCount: 3, processedCount: 3, lookupErrors })
    const source = csvSource('places', 'Places', ['lat', 'lng'], [[49, -123], ['', ''], [null, 1], [49, -123], [0, 0]], ['a', 'b', 'c', 'd', 'e'])
    const addResultSource = vi.fn(() => 'geonames-output:coordinates')

    const result = await runGeoNamesRuntime({
      nodeId: 'geonames:coordinates', username: 'demo', selectedOutputs: ['name'], inputSourceId: source.id,
      inputHeader: 'lat', inputLongitudeHeader: 'lng', inputType: 'coordinates', sources: [source], addResultSource,
    })

    expect(result).toMatchObject({ inputHeader: 'lat', inputLongitudeHeader: 'lng', lookupErrors })
    expect(fetchGeoNameFeatures).toHaveBeenLastCalledWith(['49, -123', ', 1', '49, -123', '0, 0'], 'demo', expect.objectContaining({ inputType: 'coordinates' }))
    expect(addResultSource).toHaveBeenCalledWith('geonames:coordinates', ['name'],
      [['Geo 49, -123'], [''], [''], ['Geo 49, -123'], ['Geo 0, 0']], source.recordIds)
  })
})


