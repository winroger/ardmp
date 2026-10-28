import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { graph, parse, type Store } from 'rdflib'
import { parseShaclProfile } from '@/domain/NodeShape'
import { TabularDataSource } from '@/domain/DataSource'
import ReviewView from '@/views/ReviewView.vue'
import { useDataStore } from '@/stores/dataStore'
import { useShapesStore } from '@/stores/shapesStore'

const toastAddMock = vi.fn()
const buildRuntimeStagingShapesMock = vi.fn()
const generateRdfMock = vi.fn()
const serializeGraphMock = vi.fn()
const buildBrowseModelMock = vi.fn()

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAddMock }),
}))

vi.mock('@/features/browse/components/SubjectDetailDialog.vue', () => ({
  default: {
    template: '<div />',
  },
}))
vi.mock('@/features/browse/components/ReviewFilters.vue', () => ({
  default: { name: 'ReviewFilters', props: ['shapeIri', 'roots'], emits: ['query'], template: '<div class="query-form-stub" />' },
}))

vi.mock('@/services/rdf/rdfGenerator', () => ({
  generateRdf: (...args: unknown[]) => generateRdfMock(...args),
  serializeGraph: (...args: unknown[]) => serializeGraphMock(...args),
}))

vi.mock('@/services/browse/browseService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/browse/browseService')>()
  return {
    ...actual,
    buildBrowseModel: (...args: unknown[]) => buildBrowseModelMock(...args),
  }
})

vi.mock('@/services/mapping/stagingShapes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/mapping/stagingShapes')>()
  return {
    ...actual,
    buildRuntimeStagingShapes: (...args: unknown[]) => buildRuntimeStagingShapesMock(...args),
  }
})

describe('ReviewView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    toastAddMock.mockReset()
    buildRuntimeStagingShapesMock.mockReset()
    generateRdfMock.mockReset()
    serializeGraphMock.mockReset()
    buildBrowseModelMock.mockReset()
    buildRuntimeStagingShapesMock.mockReturnValue({
      profile: null,
      nodeShapes: [],
      turtle: '',
    })
    generateRdfMock.mockReturnValue({
      store: { statements: [] },
      subjectCount: 0,
      tripleCount: 0,
    })
    serializeGraphMock.mockResolvedValue('')
    buildBrowseModelMock.mockReturnValue({
      totalSubjects: 0,
      groups: [],
    })
  })

  function mountView() {
    return mount(ReviewView, {
      global: {
        stubs: {
          Message: { template: '<div class="message"><slot /></div>' },
          Button: { props: ['label'], template: '<button>{{ label }}<slot /></button>' },
          InputText: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
          SelectButton: {
            props: ['options'],
            emits: ['update:modelValue'],
            template: `
              <div class="layout-switcher">
                <button
                  v-for="option in options"
                  :key="option.value"
                  type="button"
                  class="layout-switcher__option"
                  :data-layout="option.value"
                  @click="$emit('update:modelValue', option.value)"
                >
                  <slot name="option" :option="option" />
                </button>
              </div>
            `,
          },
          Tag: { template: '<span><slot /></span>' },
        },
      },
    })
  }

  it('surfaces staging-shape generation errors instead of crashing during mount', async () => {
    const dataStore = useDataStore()
    dataStore.upsertSource(new TabularDataSource({
      id: 'source-1',
      name: 'Source One',
      headers: ['Name'],
      rows: [['Alpha']],
      role: 'source',
      origin: { kind: 'uploaded-file', filename: 'source.csv', mediaType: 'text/csv' },
    }))
    buildRuntimeStagingShapesMock.mockImplementation(() => {
      throw new Error('Synthetic staging-shape failure')
    })

    const wrapper = mountView()
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.text()).toContain('Synthetic staging-shape failure')
  })

  it('renders a thumbnail image in the left label column when a subject exposes an image URL', async () => {
    const dataStore = useDataStore()
    dataStore.upsertSource(new TabularDataSource({
      id: 'source-1',
      name: 'Source One',
      headers: ['Name'],
      rows: [['Alpha']],
      role: 'source',
      origin: { kind: 'uploaded-file', filename: 'source.csv', mediaType: 'text/csv' },
    }))
    buildBrowseModelMock.mockReturnValue({
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
        }, {
          iri: 'https://example.org/buildings/2',
          label: 'Building Two',
          classes: ['https://example.org/Building'],
          properties: [],
        }],
      }],
    })

    const wrapper = mountView()
    await Promise.resolve()
    await Promise.resolve()

    const thumbnail = wrapper.find('img.record-thumbnail')
    expect(thumbnail.exists()).toBe(true)
    expect(thumbnail.attributes('src')).toBe('https://v5.airtableusercontent.com/example/building-one.jpg')
    expect(wrapper.find('thead .record-thumbnail-slot').exists()).toBe(true)
    expect(wrapper.findAll('tbody .record-thumbnail-slot')).toHaveLength(1)
    expect(wrapper.text()).toContain('Building One')
    expect(wrapper.text()).toContain('Building Two')
  })

  it('renders a card view with thumbnail, label, id and class chips', async () => {
    const dataStore = useDataStore()
    dataStore.upsertSource(new TabularDataSource({
      id: 'source-1',
      name: 'Source One',
      headers: ['Name'],
      rows: [['Alpha']],
      role: 'source',
      origin: { kind: 'uploaded-file', filename: 'source.csv', mediaType: 'text/csv' },
    }))
    buildBrowseModelMock.mockReturnValue({
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
    })

    const wrapper = mountView()
    await Promise.resolve()
    await Promise.resolve()

    await wrapper.find('[data-layout="card"]').trigger('click')
    await Promise.resolve()

    expect(wrapper.find('.card-grid').exists()).toBe(true)
    expect(wrapper.find('img.subject-card__thumbnail').attributes('src')).toBe('https://v5.airtableusercontent.com/example/building-one.jpg')
    expect(wrapper.find('.subject-card__label').text()).toBe('Building One')
    expect(wrapper.find('.subject-card__meta').text()).toBe('1')
    expect(wrapper.text()).toContain('Building')
  })

  function prepareFilterFixture() {
    const prefix = 'http://example.org/'
    const shapes = `@prefix ex: <${prefix}> . @prefix sh: <http://www.w3.org/ns/shacl#> .
      ex:BuildingShape a sh:NodeShape; sh:targetClass ex:Building .
      ex:OtherShape a sh:NodeShape; sh:targetClass ex:Building .`
    useShapesStore().ap.upsert(parseShaclProfile(shapes, 'buildings.ttl', 'uploaded'))
    useDataStore().upsertSource(new TabularDataSource({ id: 'source', name: 'Buildings', headers: ['Name'], rows: [['Alpha'], ['Beta']] }))
    const store = graph()
    parse(`@prefix ex: <${prefix}> . ex:a a ex:Building; ex:name "Alpha" . ex:b a ex:Building; ex:name "Beta" .`, store, prefix, 'text/turtle')
    generateRdfMock.mockReturnValue({ store })
    serializeGraphMock.mockImplementation((value: Store) => Promise.resolve(value.statements.map(statement => statement.toNT()).join('\n')))
    buildBrowseModelMock.mockReturnValue({ totalSubjects: 2, groups: [{ classIri: `${prefix}Building`, classLabel: 'Building', count: 2,
      subjects: ['Alpha', 'Beta'].map((label, index) => ({ iri: `${prefix}${index ? 'b' : 'a'}`, classes: [`${prefix}Building`], label, properties: [] })),
    }] })
    const field = { id: 'name', path: [`${prefix}name`] }
    return { query: { rootShapeId: `${prefix}BuildingShape`, targetClass: `${prefix}Building`, criteria: [
      { field, operator: 'contains' as const, value: { termType: 'Literal' as const, value: 'Alpha' } },
    ] }, fields: [field] }
  }

  it('keeps search outside the dialog and applies shape filters to List, Cards and Turtle', async () => {
    const value = prepareFilterFixture()
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.toolbar .class-filter').exists()).toBe(false)
    expect(wrapper.find('.toolbar .search-input').exists()).toBe(true)
    expect(wrapper.find('dialog .search-input').exists()).toBe(false)
    expect(wrapper.find('.query-form-stub').exists()).toBe(false)
    await wrapper.find('.shape-filter-toggle').trigger('click')
    expect(wrapper.find<HTMLDialogElement>('dialog').element.open).toBe(true)
    expect(wrapper.find<HTMLButtonElement>('.apply-filters').element.disabled).toBe(true)
    await wrapper.find('.class-filter select').setValue('http://example.org/Building')
    const form = wrapper.findComponent({ name: 'ReviewFilters' })
    form.vm.$emit('query', value)
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    await wrapper.find('.apply-filters').trigger('click')
    expect(wrapper.find<HTMLDialogElement>('dialog').element.open).toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Alpha')
    expect(wrapper.find('[role="status"]').text()).toContain('1 of 2 subjects')
    await wrapper.find('.shape-filter-toggle').trigger('click')
    expect(wrapper.findComponent({ name: 'ReviewFilters' }).element).toBe(form.element)
    await wrapper.find('[aria-label="Filter profile"]').setValue('http://example.org/OtherShape')
    await wrapper.find('.filter-dialog-close').trigger('click')
    expect(wrapper.find('tbody').text()).toContain('Alpha')
    await wrapper.find('.shape-filter-toggle').trigger('click')
    expect(wrapper.find<HTMLSelectElement>('[aria-label="Filter profile"]').element.value).toBe('http://example.org/OtherShape')
    await wrapper.find('.filter-dialog-close').trigger('click')
    await wrapper.find('[data-layout="card"]').trigger('click')
    expect(wrapper.findAll('.subject-card')).toHaveLength(1)
    await wrapper.find('[data-layout="ttl"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.ttl-output').text()).toContain('Alpha')
    expect(wrapper.find('.ttl-output').text()).not.toContain('Beta')
    expect(wrapper.find('[role="status"]').text()).toContain('1 of 2 subjects')
    expect(wrapper.find('.shape-filter-toggle').exists()).toBe(true)
    expect(generateRdfMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('combines immediate search with draft facets and clears the filters from the dialog', async () => {
    const value = prepareFilterFixture()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('.shape-filter-toggle').trigger('click')
    await wrapper.find('.class-filter select').setValue('http://example.org/Building')
    wrapper.findComponent({ name: 'ReviewFilters' }).vm.$emit('query', value)
    await wrapper.find('.apply-filters').trigger('click')
    expect(wrapper.find('tbody').text()).toContain('Alpha')
    await wrapper.find('.shape-filter-toggle').trigger('click')
    await wrapper.find('.search-input').setValue('Beta')
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.findComponent({ name: 'ReviewFilters' }).props('roots')).toEqual(['http://example.org/b'])
    await wrapper.find('[aria-label="Filter profile"]').setValue('http://example.org/OtherShape')
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.findComponent({ name: 'ReviewFilters' }).props('shapeIri')).toBe('http://example.org/OtherShape')
    // A late event from the previous profile cannot restore its criteria.
    wrapper.findComponent({ name: 'ReviewFilters' }).vm.$emit('query', value)
    await wrapper.find('.apply-filters').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Beta')
    await wrapper.find('.shape-filter-toggle').trigger('click')
    await wrapper.findAll('.filter-dialog-footer button').find(button => button.text() === 'Clear filters')!.trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find<HTMLSelectElement>('.class-filter select').element.value).toBe('')
    expect(wrapper.find('.query-form-stub').exists()).toBe(false)
    expect(wrapper.find<HTMLButtonElement>('.apply-filters').element.disabled).toBe(true)
    expect(wrapper.find('.shape-filter-toggle').text()).toBe('Filters')
    expect(generateRdfMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('updates Turtle and Cards immediately for search, with an empty output for no matches', async () => {
    prepareFilterFixture()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('[data-layout="ttl"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.ttl-output').text()).toContain('Alpha')
    expect(wrapper.find('.ttl-output').text()).toContain('Beta')
    await wrapper.find('.search-input').setValue('Alpha')
    await flushPromises()
    expect(wrapper.find('.ttl-output').text()).toContain('Alpha')
    expect(wrapper.find('.ttl-output').text()).not.toContain('Beta')
    await wrapper.find('.search-input').setValue('No match')
    await flushPromises()
    expect(wrapper.find('.ttl-output').text()).toBe('')
    expect(wrapper.text()).toContain('No subjects match')
    await wrapper.find('.search-input').setValue('Beta')
    await flushPromises()
    expect(wrapper.find('.ttl-output').text()).toContain('Beta')
    await wrapper.find('[data-layout="card"]').trigger('click')
    expect(wrapper.findAll('.subject-card')).toHaveLength(1)
    expect(wrapper.find('.subject-card').text()).toContain('Beta')
    expect(generateRdfMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('discards older Turtle serialization results and copies the current filtered output', async () => {
    prepareFilterFixture()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('[data-layout="ttl"]').trigger('click')
    await flushPromises()
    let resolveOlder!: (value: string) => void
    serializeGraphMock.mockImplementationOnce(() => new Promise<string>(resolve => { resolveOlder = resolve }))
    await wrapper.find('.search-input').setValue('Alpha')
    await wrapper.find('.search-input').setValue('Beta')
    await flushPromises()
    const current = wrapper.find('.ttl-output').text()
    expect(current).toContain('Beta')
    expect(current).not.toContain('Alpha')
    resolveOlder('Older Alpha result')
    await flushPromises()
    expect(wrapper.find('.ttl-output').text()).toBe(current)
    const writeText = vi.fn().mockResolvedValue(undefined)
    const clipboard = vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
    await wrapper.find('.ttl-actions button').trigger('click')
    expect(writeText).toHaveBeenCalledWith(current)
    clipboard.mockRestore()
    wrapper.unmount()
  })
})
