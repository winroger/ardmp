import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ApplicationProfile, parseShaclProfile, type ShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { csvSource } from '@/test/dataSources'

const MINIMAL_EXPORT_FIXTURE_DIR = path.resolve(
  __dirname,
  'fixtures',
  'minimal-export',
)

export function readMinimalExportFixture(name: string): string {
  return readFileSync(path.join(MINIMAL_EXPORT_FIXTURE_DIR, name), 'utf8')
}

export function createMinimalExportProfile(): ShaclProfile {
  return parseShaclProfile(
    readMinimalExportFixture('profile.ttl'),
    'profile.ttl',
    'uploaded',
  )
}

export function createMinimalExportApplicationProfile(): ApplicationProfile {
  const ap = new ApplicationProfile()
  ap.upsert(createMinimalExportProfile())
  return ap
}

export function createMinimalExportSource() {
  return csvSource(
    'source-csv',
    'source csv',
    ['id', 'Name', 'Year', 'Website'],
    [
      ['b1', 'Building A', '2020', 'https://example.org/building-a'],
      ['b2', 'Building B', '2021', 'https://example.org/building-b'],
    ],
  )
}

export function createMinimalExportMapping(): MappingState {
  const mapping = new MappingState()
  mapping.addOrReplace({
    sourceId: 'source-csv',
    sourceHeader: 'Name',
    shapeIri: 'http://example.org/BuildingShape',
    propertyPath: 'http://example.org/name',
  })
  mapping.addOrReplace({
    sourceId: 'source-csv',
    sourceHeader: 'Year',
    shapeIri: 'http://example.org/BuildingShape',
    propertyPath: 'http://example.org/year',
  })
  mapping.addOrReplace({
    sourceId: 'source-csv',
    sourceHeader: 'Website',
    shapeIri: 'http://example.org/BuildingShape',
    propertyPath: 'http://schema.org/url',
  })
  return mapping
}
