import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import cytoscape, { type CytoscapeOptions, type ElementDefinition } from 'cytoscape'
import SubjectDetailDialog from '@/features/browse/components/SubjectDetailDialog.vue'
import type { BrowseModel } from '@/services/browse/browseService'

vi.mock('cytoscape', () => ({
  default: vi.fn(() => ({
    on: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn() })),
    fit: vi.fn(),
    destroy: vi.fn(),
  })),
}))

vi.mock('@ulb-darmstadt/shacl-form', () => ({}))

vi.mock('@ulb-darmstadt/shacl-form/plugins/leaflet.js', () => ({
  LeafletPlugin: class {},
}))

vi.mock('@/features/shacl/useShaclFormViewer', () => ({
  useShaclFormViewer: vi.fn(),
}))

describe('SubjectDetailDialog', () => {
  it('renders a subject thumbnail above the SHACL form when an image URL is present', () => {
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
  })

  it('colors related subjects by class and displays their class names in the legend', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const model: BrowseModel = { totalSubjects: 2, groups: [
      { classIri: 'urn:Building', classLabel: 'Building', count: 1, subjects: [{ iri: 'urn:b', label: 'Building One', classes: ['urn:Building'],
        properties: [{ label: 'Architect', predicate: 'urn:architect', value: 'urn:o', isResource: true }] }] },
      { classIri: 'urn:Organization', classLabel: 'Organization', count: 1, subjects: [{ iri: 'urn:o', label: 'XY Architects', classes: ['urn:Organization'], properties: [] }] },
    ] }
    const wrapper = mount(SubjectDetailDialog, {
      props: { modelValue: true, subjectIri: 'urn:b', model, shapes: [], shapesTurtle: '', valuesTurtle: '' },
      global: { stubs: { Dialog: { template: '<div><slot /></div>' }, Button: true, Tag: true, 'shacl-form': true } },
    })
    try {
      await wrapper.findAll('.detail-tab')[1].trigger('click')
      await flushPromises()
      const options = vi.mocked(cytoscape).mock.calls.at(-1)![0] as unknown as CytoscapeOptions
      const nodes = (options.elements as ElementDefinition[]).filter(element => element.data.iri)
      expect(nodes.map(node => node.data.color)).toEqual(['#dbeafe', '#dcfce7'])
      expect(wrapper.find('[aria-label="Relationship class colors"]').text()).toContain('Building')
      expect(wrapper.find('[aria-label="Relationship class colors"]').text()).toContain('Organization')
      expect(options.style).toEqual(expect.arrayContaining([
        expect.objectContaining({ selector: 'node', style: expect.objectContaining({ 'background-color': 'data(color)' }) }),
      ]))
    } finally {
      wrapper.unmount()
      vi.unstubAllGlobals()
    }
  })
})
