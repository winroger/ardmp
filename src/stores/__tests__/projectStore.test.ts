import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useProjectStore } from '@/stores/projectStore'
import { useShapesStore } from '@/stores/shapesStore'
import { createAirtableDataSource } from '@/features/mapping/extensions/modules/source-data/airtable/workflow'
import { getEmbeddedExampleProjectSnapshot } from '@/services/project/loadEmbeddedExampleProject'
import {
  addGeoNamesNode,
  geoNamesNodes,
  geoNamesUiEdges,
  upsertGeoNamesUiEdge,
} from '@/test/mappingExtensionFixtures'

const SHAPE_PROFILE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <http://example.org/> .

ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:name ;
    sh:name "Name"
  ] .
`

const METADATA_PROFILE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix ex: <http://example.org/> .

ex:DatasetShape a sh:NodeShape ;
  sh:targetClass dcat:Dataset ;
  sh:property [
    sh:path ex:title ;
    sh:name "Title"
  ] .
`

describe('projectStore snapshot persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')
  })

  it('creates and restores a full project snapshot across stores', async () => {
    const project = useProjectStore()
    const data = useDataStore()
    const shapes = useShapesStore()
    const metadata = useMetadataStore()
    const mapping = useMappingStore()

    project.project.title = 'Dataset A'
    project.project.createdAt = '2026-05-13T10:00:00.000Z'

    await shapes.addProfileFromTurtle(SHAPE_PROFILE, 'shape.ttl', 'http://example.org/profile')
    await metadata.addRootFromTurtle(METADATA_PROFILE, 'metadata.ttl', 'http://example.org/meta-profile')
    metadata.setMetadataTurtle('http://example.org/meta-profile', '@prefix ex: <http://example.org/> .\nex:dataset ex:title "Dataset A" .')

    data.upsertSource(createAirtableDataSource({
      baseId: 'appBase',
      tableId: 'tblProjects',
      tableName: 'Projects',
      headers: ['Name'],
      rows: [['Alpha']],
      recordIds: ['rec1'],
    }))

    const geoNode = addGeoNamesNode(mapping, 'demo-user')
    upsertGeoNamesUiEdge(mapping, {
      id: 'geo-ui:input',
      source: 'src:airtable:appBase:tblProjects',
      sourceHandle: 'h:Name',
      target: geoNode.id,
      targetHandle: 'geo-input',
    })
    mapping.set({
      sourceId: 'airtable:appBase:tblProjects',
      sourceHeader: 'Name',
      shapeIri: 'http://example.org/PersonShape',
      propertyPath: 'http://example.org/name',
    })

    const snapshot = project.createSnapshot()

    project.reset()

    expect(data.sources).toHaveLength(0)
    expect(shapes.profiles).toHaveLength(0)
    expect(metadata.rootProfiles).toHaveLength(0)
    expect(mapping.state.edges).toHaveLength(0)

    project.restoreSnapshot(snapshot)

    expect(project.project.title).toBe('Dataset A')
    expect(project.project.createdAt).toBe('2026-05-13T10:00:00.000Z')
    expect(data.sources).toHaveLength(1)
    expect(data.sources[0]?.id).toBe('airtable:appBase:tblProjects')
    expect(shapes.profiles).toHaveLength(1)
    expect(metadata.rootProfiles).toHaveLength(1)
    expect(metadata.metadataTurtle['http://example.org/meta-profile']).toContain('Dataset A')
    expect(geoNamesNodes(mapping)).toHaveLength(1)
    expect(geoNamesNodes(mapping)[0]?.id).toBe(geoNode.id)
    expect(geoNamesUiEdges(mapping)).toHaveLength(1)
    expect(mapping.state.edges).toHaveLength(1)
  })

  it('uses a configured snapshot repository port for save and load', async () => {
    const project = useProjectStore()
    const shapes = useShapesStore()

    project.project.title = 'Saved dataset'
    await shapes.addProfileFromTurtle(SHAPE_PROFILE, 'shape.ttl', 'http://example.org/profile')

    const expectedSnapshot = project.createSnapshot()
    const repository = {
      saveSnapshot: vi.fn(async () => undefined),
      loadSnapshot: vi.fn(async () => expectedSnapshot),
      clearSnapshot: vi.fn(async () => undefined),
    }

    project.setSnapshotRepository(repository)

    const savedSnapshot = await project.saveSnapshot()
    expect(savedSnapshot.project.title).toBe('Saved dataset')
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(1)

    project.reset()
    await project.loadSnapshot()

    expect(repository.loadSnapshot).toHaveBeenCalledTimes(1)
    expect(project.project.title).toBe('Saved dataset')

    await project.clearSnapshot()
    expect(repository.clearSnapshot).toHaveBeenCalledTimes(1)
  })

  it('resets and restores the embedded showcase snapshot as one project boundary', () => {
    const project = useProjectStore()
    const data = useDataStore()
    const shapes = useShapesStore()
    const metadata = useMetadataStore()
    const mapping = useMappingStore()
    const snapshot = getEmbeddedExampleProjectSnapshot()

    project.restoreSnapshot(snapshot)

    expect(project.project.title).toBe(snapshot.project.title)
    expect(data.sources).toHaveLength(snapshot.sources.length)
    expect(shapes.profiles).toHaveLength(snapshot.shapeProfiles.length)
    expect(metadata.rootIris).toHaveLength(snapshot.metadataRootIris.length)
    expect(mapping.state.edges).toHaveLength(snapshot.mapping.edges.length)

    project.reset()

    expect(project.project.title).toBe('Untitled dataset')
    expect(data.sources).toHaveLength(0)
    expect(shapes.profiles).toHaveLength(0)
    expect(metadata.rootIris).toHaveLength(0)
    expect(metadata.getCombinedMetadataTurtle()).toBe('')
    expect(mapping.state.edges).toHaveLength(0)

    project.restoreSnapshot(snapshot)

    expect(project.project.title).toBe(snapshot.project.title)
    expect(data.sources).toHaveLength(snapshot.sources.length)
    expect(shapes.profiles).toHaveLength(snapshot.shapeProfiles.length)
    expect(metadata.rootIris).toHaveLength(snapshot.metadataRootIris.length)
    expect(mapping.state.edges).toHaveLength(snapshot.mapping.edges.length)
  })
})


