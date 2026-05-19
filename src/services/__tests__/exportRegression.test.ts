import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPLEX_EXPORT_FIXTURE_DIR = path.resolve(
  __dirname,
  'fixtures',
  'complex-export',
)

function readComplexExportFixture(relativePath: string): string {
  return readFileSync(path.join(COMPLEX_EXPORT_FIXTURE_DIR, relativePath), 'utf8')
}

describe('complex export regression fixture', () => {
  it('remains structurally complete and aligned with the current export contract', () => {
    const roCrate = JSON.parse(readComplexExportFixture('ro-crate-metadata.json')) as {
      '@graph': Array<Record<string, unknown>>
    }
    const rml = readComplexExportFixture('mapping/mapping.rml.ttl')
    const datasetTurtle = readComplexExportFixture('data/dataset.ttl')

    const graph = roCrate['@graph']
    const root = graph.find(entity => entity['@id'] === './') as
      | (Record<string, unknown> & {
        creator?: Array<{ '@id': string }>
        hasPart?: Array<{ '@id': string }>
      })
      | undefined
    const hasPartPaths = (root?.hasPart ?? []).map(part => part['@id'])
    const creatorIds = (root?.creator ?? []).map(creator => creator['@id'])

    expect(root).toBeTruthy()
    expect(root?.['@type']).toBe('Dataset')
    expect(root?.name).toBe("Roger's Testdatensatz")
    expect(hasPartPaths).toEqual(expect.arrayContaining([
      'data/dataset.ttl',
      'mapping/mapping.rml.ttl',
      'sources/geonames_geonames_ffa59aaf-19ce-495d-9550-78288c16c8d4.csv',
      'sources/lat-lng-to-wkt_transform_e617853e-dfdc-44ef-a7b4-d04524fe232e.csv',
      'README.md',
    ]))
    expect(hasPartPaths).not.toContain('mapping/mapping.json')
    expect(creatorIds).toContain('https://orcid.org/0000-0001-6259-4068')

    expect(rml).toContain('sources/N_Places.csv')
    expect(rml).toContain('sources/geonames_geonames_ffa59aaf-19ce-495d-9550-78288c16c8d4.csv')
    expect(rml).toContain('POINT({lng} {lat})')
    expect(rml).toContain('sources/L_Buildings_Organizations_Roles.csv')

    expect(datasetTurtle).toContain('<urn:ardmp:metadata:dataset> a dcat:Dataset;')
    expect(datasetTurtle).toContain('# ----- Generated RDF data -----')
    expect(
      datasetTurtle.indexOf('<urn:ardmp:metadata:dataset> a dcat:Dataset;'),
    ).toBeLessThan(datasetTurtle.indexOf('# ----- Generated RDF data -----'))
    expect(datasetTurtle).toContain('ge:asWKT')

    for (const part of hasPartPaths) {
      expect(existsSync(path.join(COMPLEX_EXPORT_FIXTURE_DIR, part))).toBe(true)
    }
  })
})
