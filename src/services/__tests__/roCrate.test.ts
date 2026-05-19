import { describe, expect, it } from 'vitest'
import { buildRoCrateMetadata } from '@/core/export/roCrate'

describe('buildRoCrateMetadata', () => {
  it('produces a valid RO-Crate 1.2 descriptor with metadata file + root dataset', () => {
    const json = buildRoCrateMetadata({
      name: 'My dataset',
      datePublished: '2026-04-29T10:00:00Z',
      files: [
        { path: 'data/dataset.ttl', name: 'Generated graph', encodingFormat: 'text/turtle' },
      ],
    })
    const obj = JSON.parse(json)
    expect(obj['@context']).toEqual([
      'https://w3id.org/ro/crate/1.2/context',
      { '@vocab': 'http://schema.org/' },
    ])
    const ids = (obj['@graph'] as { '@id': string }[]).map(e => e['@id'])
    expect(ids).toContain('ro-crate-metadata.json')
    expect(ids).toContain('./')
    expect(ids).toContain('data/dataset.ttl')

    const metaFile = obj['@graph'].find((e: { '@id': string }) => e['@id'] === 'ro-crate-metadata.json')
    expect(metaFile.conformsTo).toEqual({ '@id': 'https://w3id.org/ro/crate/1.2' })
    expect(metaFile.about).toEqual({ '@id': './' })
    expect(metaFile.identifier).toBe('ro-crate-metadata.json')

    const root = obj['@graph'].find((e: { '@id': string }) => e['@id'] === './')
    expect(root['@type']).toBe('Dataset')
    expect(root.name).toBe('My dataset')
    expect(root.hasPart).toEqual([{ '@id': 'data/dataset.ttl' }])
  })

  it('emits multiple agents and license when derived dataset metadata is provided', () => {
    const json = buildRoCrateMetadata({
      name: 'Dataset B',
      datePublished: '2026-05-12',
      license: 'http://creativecommons.org/licenses/by/4.0/',
      agents: [
        { name: 'Alice Example', type: 'Person', url: 'https://example.org/alice' },
        { name: 'Acme Org', type: 'Organization', url: 'https://acme.example.org/' },
      ],
      files: [],
    })

    const obj = JSON.parse(json)
    const root = obj['@graph'].find((e: { '@id': string }) => e['@id'] === './')
    expect(root.license).toEqual({ '@id': 'http://creativecommons.org/licenses/by/4.0/' })
    expect(root.creator).toHaveLength(2)

    const agents = obj['@graph'].filter((e: { '@type': string }) => e['@type'] === 'Person' || e['@type'] === 'Organization')
    expect(agents).toHaveLength(2)
    expect(agents.map((agent: { name: string }) => agent.name)).toEqual(['Alice Example', 'Acme Org'])
  })

  it('does not emit duplicate creator entities when agents are used', () => {
    const json = buildRoCrateMetadata({
      name: 'Dataset C',
      datePublished: '2026-05-12',
      agents: [
        { id: 'metadata-agent-0', name: 'Hana', type: 'Person' },
        { id: 'metadata-agent-1', name: 'Roger', type: 'Person' },
      ],
      files: [],
    })

    const obj = JSON.parse(json)
    const personIds = obj['@graph']
      .filter((entity: { '@type': string }) => entity['@type'] === 'Person')
      .map((entity: { '@id': string }) => entity['@id'])

    expect(personIds).toEqual(['#agent-metadata-agent-0', '#agent-metadata-agent-1'])
  })
})



