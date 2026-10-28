import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { graph } from 'rdflib'
import rdf from '@rdfjs/data-model'
import type { QueryFacetProvider, ShaclForm } from '@ulb-darmstadt/shacl-form'
import { ReviewQueryIndex } from '@/services/browse/reviewQuery'
import { reviewQueryFields } from '@/features/browse/reviewQueryFields'
import ReviewFilters from '@/features/browse/components/ReviewFilters.vue'

vi.mock('@ulb-darmstadt/shacl-form', () => ({}))
vi.mock('@/features/browse/reviewQueryFields', () => ({ reviewQueryFields: vi.fn(() => []) }))

const props = () => ({ shapesTurtle: '', shapeIri: 'urn:BuildingShape', index: new ReviewQueryIndex(graph()), roots: [] as string[] })
const options = { global: { stubs: { Message: { template: '<div role="alert"><slot /></div>' } } } }

afterEach(() => vi.restoreAllMocks())

describe('ReviewFilters initialization', () => {
  it('reports an outdated or unavailable custom-element API without throwing from the mount hook', async () => {
    const wrapper = mount(ReviewFilters, { props: props(), ...options })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('The loaded shacl-form version does not support filters')
    expect(wrapper.find('[role="alert"]').text()).toContain('Restart the development server')
    wrapper.unmount()
  })

  it('configures the provider before connecting, refreshes facets, and removes listeners on unmount', async () => {
    const create = document.createElement.bind(document)
    const form = create('shacl-form') as ShaclForm
    let provider: QueryFacetProvider | undefined
    form.setQueryFacetProvider = vi.fn(value => {
      expect(form.isConnected).toBe(false)
      provider = value
    })
    form.refreshQueryFacets = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => tag === 'shacl-form' ? form : create(tag, options))
    const wrapper = mount(ReviewFilters, { props: props(), ...options })
    const query = { rootShapeId: 'urn:BuildingShape', criteria: [] }
    const event = () => new CustomEvent('query', { detail: query })
    form.dispatchEvent(event())
    expect(wrapper.emitted('query')).toHaveLength(1)
    expect(vi.mocked(reviewQueryFields)).toHaveBeenCalledWith(form)
    const pendingQuery = { ...query, criteria: [{ field: { id: 'name', path: ['urn:name'] }, operator: 'contains' as const, value: rdf.literal('Pending input') }] }
    form.shape = {} as NonNullable<ShaclForm['shape']>
    form.getQuery = () => pendingQuery
    expect(wrapper.vm.getQuery()?.query).toEqual(pendingQuery)
    await provider!.getFacets({ query, fields: [], signal: new AbortController().signal })
    await flushPromises()
    expect(wrapper.text()).toContain('No filter values are available')
    await wrapper.setProps({ roots: ['urn:building'] })
    expect(form.refreshQueryFacets).toHaveBeenCalledTimes(1)
    const callsBeforeUnmount = vi.mocked(reviewQueryFields).mock.calls.length
    wrapper.unmount()
    form.dispatchEvent(event())
    expect(vi.mocked(reviewQueryFields).mock.calls).toHaveLength(callsBeforeUnmount)
  })
})
