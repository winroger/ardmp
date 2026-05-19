import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '@/stores/dataStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useProjectStore } from '@/stores/projectStore'
import { useShapesStore } from '@/stores/shapesStore'
import {
  getEmbeddedExampleProjectSnapshot,
  loadEmbeddedExampleProject,
} from '@/services/project/loadEmbeddedExampleProject'

describe('loadEmbeddedExampleProject', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('loads the embedded showcase snapshot through the project boundary', async () => {
    const project = useProjectStore()
    const data = useDataStore()
    const shapes = useShapesStore()
    const metadata = useMetadataStore()
    const mapping = useMappingStore()
    const snapshot = getEmbeddedExampleProjectSnapshot()
    const toast = { add: vi.fn() }
    const resetUiState = vi.fn()

    await loadEmbeddedExampleProject({
      projectStore: project,
      toast,
      resetUiState,
    })

    expect(resetUiState).toHaveBeenCalledTimes(1)
    expect(project.project.title).toBe(snapshot.project.title)
    expect(data.sources).toHaveLength(snapshot.sources.length)
    expect(shapes.profiles).toHaveLength(snapshot.shapeProfiles.length)
    expect(metadata.rootIris).toHaveLength(snapshot.metadataRootIris.length)
    expect(metadata.getCombinedMetadataTurtle()).toContain('Example Linked Building Dataset')
    expect(mapping.state.edges).toHaveLength(snapshot.mapping.edges.length)
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'success',
      summary: 'Example loaded',
    }))
  })

  it('returns a readable embedded example snapshot', () => {
    const snapshot = getEmbeddedExampleProjectSnapshot()

    expect(snapshot.project.title.length).toBeGreaterThan(0)
    expect(snapshot.sources).toHaveLength(2)
    expect(snapshot.shapeProfiles.length).toBeGreaterThan(0)
    expect(snapshot.mapping.edges.length).toBeGreaterThan(0)
    expect(snapshot.sources.every(source => source.origin?.kind === 'uploaded-file')).toBe(true)
    expect(snapshot.sources.some(source => source.id.includes('airtable'))).toBe(false)
    expect(snapshot.metadataRootIris).toEqual(['https://w3id.org/nfdi4ing/profiles/4a5d4526-34d4-4b00-8f8f-4b13dd48e6d6'])
    expect(snapshot.metadataProfiles).toHaveLength(1)
    expect(Object.values(snapshot.metadataTurtle).join('\n')).toContain('Minimal showcase dataset demonstrating buildings linked to structured location records.')
    expect(snapshot.mapping.extensionState).toEqual({})
  })
})
