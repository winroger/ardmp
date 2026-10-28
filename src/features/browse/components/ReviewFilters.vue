<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@ulb-darmstadt/shacl-form'
import type { Query, ShaclForm } from '@ulb-darmstadt/shacl-form'
import Message from 'primevue/message'
import type { ReviewQuery, ReviewQueryIndex } from '@/services/browse/reviewQuery'
import { reviewQueryFields } from '@/features/browse/reviewQueryFields'

const props = defineProps<{
  shapesTurtle: string
  shapeIri: string
  index: ReviewQueryIndex
  roots: string[]
}>()
const emit = defineEmits<{ query: [value: ReviewQuery] }>()
const host = ref<HTMLElement | null>(null)
const error = ref('')
const empty = ref(false)
let form: ShaclForm | undefined
const lifecycle = new AbortController()

function onQuery(event: Event): void {
  const query = (event as CustomEvent<Query>).detail
  empty.value = false
  emit('query', { query, fields: reviewQueryFields(form!) })
}

// Read controls synchronously when Apply is clicked, including pending
// debounced text changes that have not emitted a query event yet.
function getQuery(): ReviewQuery | null {
  return form?.shape ? { query: form.getQuery(), fields: reviewQueryFields(form) } : null
}
defineExpose({ getQuery })

function onQueryError(): void {
  error.value = 'Filters could not be loaded. Clear the filters or try another profile.'
}

function initializeForm(): void {
  // Configure the provider and listeners before connecting the element, so the
  // initial facet request is local and the unfiltered controls never flash.
  form = document.createElement('shacl-form') as ShaclForm
  if (typeof form.setQueryFacetProvider !== 'function') {
    throw new Error('The loaded shacl-form version does not support filters. Restart the development server and reload this page.')
  }
  form.setAttribute('data-mode', 'query')
  form.setAttribute('data-shapes', props.shapesTurtle)
  form.setAttribute('data-shape-subject', props.shapeIri)
  form.setAttribute('data-ignore-owl-imports', '')
  form.setAttribute('data-collapse', 'open')
  form.setAttribute('data-loading', 'Loading filters…')
  form.setAttribute('aria-label', 'Shape filters')
  form.setQueryFacetProvider({
    async getFacets({ query, signal }) {
      if (lifecycle.signal.aborted) return []
      error.value = ''
      const fields = reviewQueryFields(form!)
      const facets = props.index.facets({ query, fields }, props.roots, signal)
      empty.value = facets.every(facet => facet.count === 0) && query.criteria.length === 0
      return facets
    },
  })
  form.addEventListener('query', onQuery)
  form.addEventListener('queryerror', onQueryError)
  host.value?.append(form)
}

function removeForm(): void {
  form?.removeEventListener('query', onQuery)
  form?.removeEventListener('queryerror', onQueryError)
  clearTimeout(form?.initDebounceTimeout)
  form?.remove()
}

onMounted(() => {
  try {
    initializeForm()
  } catch (cause) {
    error.value = `Filters could not be initialized. ${cause instanceof Error ? cause.message : String(cause)}`
    removeForm()
  }
})

watch(() => [props.index, props.roots], () => form?.refreshQueryFacets())
onBeforeUnmount(() => {
  lifecycle.abort()
  removeForm()
})
</script>

<template>
  <div class="review-filters">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <p v-if="empty" class="filters-empty">No filter values are available for the current selection.</p>
    <div ref="host" />
  </div>
</template>

<style scoped>
.review-filters { padding: var(--space-3); }
.filters-empty { color: var(--color-text-muted); }
:deep(shacl-form) {
  display: block;
  --shacl-font-family: var(--font-sans);
  --shacl-border-color: var(--color-border);
}
</style>
