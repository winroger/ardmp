import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseShaclProfile } from '@/domain/NodeShape'
import { fetchAimsProfileTurtle, loadAimsProfiles } from '@/services/infrastructure/imports/aimsProfileService'

const baseUrl = 'https://w3id.org/nfdi4ing/profiles/75c167b6-6aaa-4235-9d56-b59522ffeb60/'
const profile = { name: 'AFM cantilever', base_url: baseUrl, definition: null }
const turtle = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
<${baseUrl}> a sh:NodeShape ; sh:targetClass <https://example.org/Cantilever> .
`

afterEach(() => vi.unstubAllGlobals())

describe('AIMS profile downloads', () => {
  it('loads a usable SHACL definition when the catalogue definition is null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([profile]), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(turtle, {
        headers: { 'Content-Type': 'text/turtle' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const profiles = await loadAimsProfiles()
    const downloaded = await fetchAimsProfileTurtle(profiles[0]!)
    const parsed = parseShaclProfile(downloaded, 'AFM cantilever.ttl', 'fetched', baseUrl)

    expect(parsed.nodeShapes).toHaveLength(1)
    expect(parsed.nodeShapes[0]?.targetClass?.value).toBe('https://example.org/Cantilever')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://aims-backend.tools.coscine.dev/AIMS/application-profiles/RawRDF/https%3A%2F%2Fw3id.org%2Fnfdi4ing%2Fprofiles%2F75c167b6-6aaa-4235-9d56-b59522ffeb60%2F',
    )
    expect(fetchMock.mock.calls[1]?.[1]?.headers.Accept).toBe('text/turtle')
  })

  it('preserves versioned profile IRIs in the raw RDF request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(turtle))
    vi.stubGlobal('fetch', fetchMock)
    await fetchAimsProfileTurtle({ ...profile, base_url: `${baseUrl}1758039490455/` })
    expect(fetchMock.mock.calls[0]?.[0]).toContain('%2F1758039490455%2F')
  })

  it('reports HTTP errors instead of returning them as Turtle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })))
    await expect(fetchAimsProfileTurtle(profile)).rejects.toThrow('AIMS profile load failed: 404')
  })

  it('rejects an empty definition instead of importing an empty profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(' \n ')))
    await expect(fetchAimsProfileTurtle(profile)).rejects.toThrow('empty Turtle response')
  })
})
