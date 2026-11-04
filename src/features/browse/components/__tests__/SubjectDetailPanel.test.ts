import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { parseShaclProfile } from '@/domain/NodeShape'
import type { BrowseModel } from '@/services/browse/browseService'
import SubjectDetailPanel from '../SubjectDetailPanel.vue'

vi.mock('@ulb-darmstadt/shacl-form', () => ({}))
vi.mock('@ulb-darmstadt/shacl-form/plugins/leaflet.js', () => ({ LeafletPlugin: class {} }))

const shapesTurtle = `@prefix ex: <http://example.org/> . @prefix sh: <http://www.w3.org/ns/shacl#> .
  ex:GenericShape a sh:NodeShape; sh:targetClass ex:Building .
  ex:BuildingShape a sh:NodeShape; sh:targetClass ex:Building; sh:property [sh:path ex:name] .
  ex:OrganizationShape a sh:NodeShape; sh:targetClass ex:Organization .`
const shapes = parseShaclProfile(shapesTurtle, 'test.ttl', 'uploaded').nodeShapes
const model: BrowseModel = { totalSubjects: 2, groups: [
  { classIri: 'http://example.org/Building', classLabel: 'Building', count: 1, subjects: [{ iri: 'http://example.org/b', label: 'Building One', classes: ['http://example.org/Building'], properties: [{ label: 'Name', predicate: 'http://example.org/name', value: 'Building One', isResource: false }] }] },
  { classIri: 'http://example.org/Organization', classLabel: 'Organization', count: 1, subjects: [{ iri: 'http://example.org/o', label: 'Architects', classes: ['http://example.org/Organization'], properties: [] }] },
] }

describe('SubjectDetailPanel', () => {
  it('renders the best matching SHACL form and replaces it when another entity is selected', async () => {
    const wrapper = mount(SubjectDetailPanel, { props: { subjectIri: 'http://example.org/b', model, shapes, shapesTurtle, valuesTurtle: 'example values' } })
    await flushPromises()
    expect(wrapper.find('shacl-form').attributes('data-values-subject')).toBe('http://example.org/b')
    expect(wrapper.find('shacl-form').attributes('data-shape-subject')).toBe('http://example.org/BuildingShape')
    expect(wrapper.find('shacl-form').attributes('data-view')).toBeDefined()
    expect(wrapper.find('shacl-form').attributes('data-show-root-shape-label')).toBeUndefined()
    expect(wrapper.find('.detail-identifier').attributes('open')).toBeUndefined()
    const original = wrapper.find('shacl-form').element
    await wrapper.setProps({ subjectIri: 'http://example.org/o' })
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Architects')
    expect(wrapper.find('shacl-form').element).not.toBe(original)
    expect(wrapper.find('shacl-form').attributes('data-values-subject')).toBe('http://example.org/o')
    expect(wrapper.find('shacl-form').attributes('data-shape-subject')).toBe('http://example.org/OrganizationShape')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.find('[aria-label="Close entity details"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
