import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import ReviewGraph from '../ReviewGraph.vue'

vi.mock('../ReviewGraphCanvas.vue', () => ({
  default: { name: 'ReviewGraphCanvas', props: ['elements', 'visibleIris', 'matchedIris', 'mode', 'labels'], template: '<div />' },
}))

function subject(iri: string, type: string, targets: string[]): BrowseSubject {
  return { iri, label: iri, classes: [type], properties: targets.map(value => ({ value, label: 'Related', predicate: 'urn:related', isResource: true })) }
}
const building = subject('urn:building', 'Building', ['urn:location', 'urn:location', 'urn:external'])
const location = subject('urn:location', 'Location', ['urn:second-hop'])
const stakeholder = subject('urn:stakeholder', 'Stakeholder', ['urn:building'])
const distant = subject('urn:second-hop', 'Source', [])
const unrelated = subject('urn:unrelated', 'Source', [])
const all = [building, location, stakeholder, distant, unrelated]
const model: BrowseModel = { totalSubjects: all.length, groups: ['Building', 'Location', 'Stakeholder', 'Source'].map(type => {
  const subjects = all.filter(subject => subject.classes.includes(type))
  return { classIri: type, classLabel: type, subjects, count: subjects.length }
}) }

describe('ReviewGraph connected entities', () => {
  it('adds incoming and outgoing direct neighbors without changing the filter matches, then hides them again', async () => {
    const wrapper = mount(ReviewGraph, { props: { model, subjects: [building] } })
    const canvas = () => wrapper.findComponent({ name: 'ReviewGraphCanvas' })
    expect(canvas().props('visibleIris')).toEqual(['urn:building'])
    await wrapper.find('[aria-label="Show connected entities"]').setValue(true)
    expect(new Set(canvas().props('visibleIris'))).toEqual(new Set(['urn:building', 'urn:location', 'urn:stakeholder']))
    expect(canvas().props('matchedIris')).toEqual(['urn:building'])
    expect(wrapper.find('.graph-footer').text().replace(/\s+/g, ' ')).toContain('1 matching entities + 2 connected (outlined)')
    expect(wrapper.findAll('.graph-inspect option')).toHaveLength(4)
    expect(wrapper.find('.graph-legend').text()).toContain('Stakeholder')
    await wrapper.findAll('.graph-display-options button')[1].trigger('click')
    expect(canvas().props('mode')).toBe('network')
    expect(canvas().props('visibleIris')).toHaveLength(3)
    await wrapper.find('[aria-label="Show connected entities"]').setValue(false)
    expect(canvas().props('visibleIris')).toEqual(['urn:building'])
    expect(wrapper.props('subjects')).toEqual([building])
    wrapper.unmount()
  })

  it('recomputes from only the new matches and adds nothing for empty results', async () => {
    const wrapper = mount(ReviewGraph, { props: { model, subjects: [building] } })
    await wrapper.find('[aria-label="Show connected entities"]').setValue(true)
    await wrapper.setProps({ subjects: [stakeholder] })
    expect(new Set(wrapper.findComponent({ name: 'ReviewGraphCanvas' }).props('visibleIris'))).toEqual(new Set(['urn:stakeholder', 'urn:building']))
    await wrapper.setProps({ subjects: [] })
    expect(wrapper.findComponent({ name: 'ReviewGraphCanvas' }).props('visibleIris')).toEqual([])
    expect(wrapper.find('.graph-message').text()).toContain('No entities match')
    wrapper.unmount()
  })
})
