import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { importCsvFiles } from '@/features/mapping/extensions/modules/source-data/csv-file/workflow'
import { useDataStore } from '@/stores/dataStore'

describe('importCsvFiles', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('extracts _recordId into recordIds and keeps linked-record columns as arrays', async () => {
    const dataStore = useDataStore()
    const locations = new File([
      '_recordId,Label,WKT\nrecLOCATION000001,Vancouver,"POINT(-123.1207 49.2827)"\nrecLOCATION000002,Portland,"POINT(-122.6765 45.5231)"\n',
    ], 'locations.csv', { type: 'text/csv' })
    const buildings = new File([
      '_recordId,PreferredName,DateOfProduction,Location,Notes\nrecBUILDING000001,Timber Hall,2020,recLOCATION000001,"Wood,Steel"\nrecBUILDING000002,Harbor House,2021,recLOCATION000002,Concrete\n',
    ], 'buildings.csv', { type: 'text/csv' })

    await importCsvFiles(dataStore, [locations, buildings])

    const importedLocations = dataStore.findById('locations.csv')
    const importedBuildings = dataStore.findById('buildings.csv')

    expect(importedLocations?.headers).toEqual(['Label', 'WKT'])
    expect(importedLocations?.recordIds).toEqual(['recLOCATION000001', 'recLOCATION000002'])
    expect(importedBuildings?.headers).toEqual(['PreferredName', 'DateOfProduction', 'Location', 'Notes'])
    expect(importedBuildings?.recordIds).toEqual(['recBUILDING000001', 'recBUILDING000002'])
    expect(importedBuildings?.rows[0]?.[2]).toEqual(['recLOCATION000001'])
    expect(importedBuildings?.rows[1]?.[2]).toEqual(['recLOCATION000002'])
    expect(importedBuildings?.rows[0]?.[3]).toBe('Wood,Steel')
  })
})
