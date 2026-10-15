import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ShapeNode from '@/features/mapping/components/canvas/ShapeNode.vue'
import { parseShaclProfile } from '@/domain/NodeShape'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { csvSource } from '@/test/dataSources'
import { createNodeOutputTabularSource } from '@/domain/DataSource'

const EX = 'http://example.org/'
const profile = () => parseShaclProfile(`
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <http://example.org/> .
ex:BuildingShape a sh:NodeShape ; sh:targetClass ex:Building ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] .
ex:LocationShape a sh:NodeShape ; sh:targetClass ex:Location ;
 sh:property [ sh:path ex:name ; sh:datatype xsd:string ] .
`, 'shapes.ttl', 'uploaded')

describe('shape subject identifier selection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function setup() {
    const source = csvSource('input', 'Buildings', ['row', 'building_id', 'geonames_id', 'name'], [['r1', 'B1', '2950159', 'Museum'], ['r2', 'B2', '', 'Unknown']])
    useDataStore().upsertSource(source)
    const mapping = useMappingStore()
    const shapes = profile().nodeShapes
    for (const shape of shapes) mapping.set({ sourceId: source.id, sourceHeader: 'name', shapeIri: shape.nodeId.value, propertyPath: `${EX}name` })
    const wrappers = shapes.map(shape => mount(ShapeNode, { props: { data: { shape } }, global: { stubs: { Handle: true } } }))
    const building = wrappers.find(wrapper => wrapper.props('data').shape.nodeId.value === `${EX}BuildingShape`)!
    const location = wrappers.find(wrapper => wrapper.props('data').shape.nodeId.value === `${EX}LocationShape`)!
    return { mapping, building, location, source }
  }

  it('selects independent identifiers per profile and reports missing row identifiers', async () => {
    const { mapping, building, location, source } = setup()
    await building.find('select').setValue(JSON.stringify([source.id, 'building_id']))
    await location.find('select').setValue(JSON.stringify([source.id, 'geonames_id']))
    expect(mapping.state.subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
    expect(mapping.state.subjectIdentifier(`${EX}LocationShape`, source.id)).toBe('geonames_id')
    expect(location.text()).toContain('1 row(s) have no valid identifier')
    expect(building.text()).not.toContain('have no valid identifier')
    await location.find('select').setValue('')
    expect(mapping.state.subjectIdentifier(`${EX}LocationShape`, source.id)).toBeUndefined()
  })

  it('retains and shows a saved identifier that disappeared from a refreshed source', () => {
    const { mapping, source } = setup()
    mapping.state.setSubjectIdentifier(`${EX}LocationShape`, source.id, 'old_id')
    const shape = profile().nodeShapes.find(item => item.nodeId.value === `${EX}LocationShape`)!
    const wrapper = mount(ShapeNode, { props: { data: { shape } }, global: { stubs: { Handle: true } } })
    expect(wrapper.text()).toContain('old_id (missing column)')
    expect(wrapper.text()).toContain('Choose an available identifier column')
  })

  it('saves and restores identifiers without aliasing and accepts legacy snapshots', async () => {
    const { mapping, building, source } = setup()
    await building.find('select').setValue(JSON.stringify([source.id, 'building_id']))
    const snapshot = mapping.createSnapshot()
    mapping.state.subjectIdentifiers[0].header = 'row'
    expect(snapshot.subjectIdentifiers![0].header).toBe('building_id')
    mapping.reset()
    expect(mapping.state.subjectIdentifiers).toEqual([])
    mapping.restoreSnapshot(snapshot)
    snapshot.subjectIdentifiers![0].header = 'name'
    expect(mapping.state.subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
    mapping.restoreSnapshot({ edges: snapshot.edges, extensionState: snapshot.extensionState })
    expect(mapping.state.subjectIdentifiers).toEqual([])
  })

  it('offers one identity selector per profile for the CSV and its GeoNames outputs', async () => {
    const { mapping, building, location, source } = setup()
    const output = createNodeOutputTabularSource({
      id: 'geo', name: 'GeoNames', provider: 'geonames', nodeId: 'geo-node', inputSourceId: source.id,
      headers: ['id', 'name'], rows: [['2950159', 'Berlin'], ['', '']], recordIds: ['r1', 'r2'],
    })
    useDataStore().upsertSource(output)
    mapping.set({ sourceId: output.id, sourceHeader: 'id', shapeIri: `${EX}BuildingShape`, propertyPath: `${EX}location` })
    mapping.set({ sourceId: output.id, sourceHeader: 'name', shapeIri: `${EX}LocationShape`, propertyPath: `${EX}enrichedName` })
    await building.find('select').setValue(JSON.stringify([source.id, 'building_id']))
    await location.find('select').setValue(JSON.stringify([output.id, 'id']))
    expect(building.findAll('select')).toHaveLength(1)
    expect(location.findAll('select')).toHaveLength(1)
    expect(building.findAll('optgroup').map(group => group.attributes('label'))).toEqual(['Buildings', 'GeoNames'])
    expect(mapping.state.subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
    expect(mapping.state.subjectIdentifier(`${EX}BuildingShape`, output.id)).toBeUndefined()
    expect(mapping.state.subjectIdentifier(`${EX}LocationShape`, output.id)).toBe('id')
    // Changing Location's identity replaces its earlier selection for the same rows.
    await location.find('select').setValue(JSON.stringify([source.id, 'geonames_id']))
    expect(mapping.state.subjectIdentifier(`${EX}LocationShape`, output.id)).toBeUndefined()
    expect(mapping.state.subjectIdentifier(`${EX}BuildingShape`, source.id)).toBe('building_id')
    await location.find('select').setValue('')
    expect(mapping.state.subjectIdentifiers.filter(item => item.shapeIri === `${EX}LocationShape`)).toEqual([])
  })
})
