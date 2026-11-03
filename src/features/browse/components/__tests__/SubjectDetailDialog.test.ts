import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SubjectDetailDialog from '@/features/browse/components/SubjectDetailDialog.vue'
import type { BrowseModel } from '@/services/browse/browseService'

vi.mock('@ulb-darmstadt/shacl-form', () => ({}))

vi.mock('@ulb-darmstadt/shacl-form/plugins/leaflet.js', () => ({
  LeafletPlugin: class {},
}))

vi.mock('@/features/shacl/useShaclFormViewer', () => ({
  useShaclFormViewer: vi.fn(),
}))

describe('SubjectDetailDialog', () => {
  it('renders subject thumbnails by default and hides them when external images are disabled', async () => {
    const wrapper = mount(SubjectDetailDialog, {
      props: {
        modelValue: true,
        subjectIri: 'https://example.org/buildings/1',
        model: {
          totalSubjects: 1,
          groups: [{
            classIri: 'https://example.org/Building',
            classLabel: 'Building',
            count: 1,
            subjects: [{
              iri: 'https://example.org/buildings/1',
              label: 'Building One',
              classes: ['https://example.org/Building'],
              properties: [{
                label: 'Thumbnail Image',
                predicate: 'http://schema.org/image',
                value: 'https://v5.airtableusercontent.com/example/building-one.jpg',
                isResource: false,
                datatype: 'http://www.w3.org/2001/XMLSchema#anyURI',
              }],
            }],
          }],
        },
        shapes: [],
        shapesTurtle: '',
        valuesTurtle: '',
      },
      global: {
        stubs: {
          Dialog: {
            props: ['visible', 'header'],
            template: '<div class="dialog"><slot /></div>',
          },
          Button: true,
          Tag: true,
          'shacl-form': true,
        },
      },
    })

    const thumbnail = wrapper.find('img.subject-preview-image')
    expect(thumbnail.exists()).toBe(true)
    expect(thumbnail.attributes('src')).toBe('https://v5.airtableusercontent.com/example/building-one.jpg')
    await wrapper.setProps({ allowExternalImages: false })
    expect(wrapper.find('img.subject-preview-image').exists()).toBe(false)
  })

  it('renders facts without relationship preview tabs and follows linked entities', async () => {
    const model: BrowseModel = { totalSubjects: 2, groups: [
      { classIri: 'urn:Building', classLabel: 'Building', count: 1, subjects: [{ iri: 'urn:b', label: 'Building One', classes: ['urn:Building'],
        properties: [{ label: 'Architect', predicate: 'urn:architect', value: 'urn:o', isResource: true }] }] },
      { classIri: 'urn:Organization', classLabel: 'Organization', count: 1, subjects: [{ iri: 'urn:o', label: 'XY Architects', classes: ['urn:Organization'], properties: [] }] },
    ] }
    const wrapper = mount(SubjectDetailDialog, {
      props: { modelValue: true, subjectIri: 'urn:b', model, shapes: [], shapesTurtle: '', valuesTurtle: '' },
      global: { stubs: { Dialog: { template: '<div><slot /></div>' }, 'shacl-form': true } },
    })
    expect(wrapper.find('.detail-tab').exists()).toBe(false)
    expect(wrapper.find('.cy-graph').exists()).toBe(false)
    await wrapper.find('.detail-properties button').trigger('click')
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('XY Architects')
    await wrapper.find('[aria-label="Close entity details"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    wrapper.unmount()
  })
})
