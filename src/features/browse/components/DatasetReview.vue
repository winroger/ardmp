<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRefs, watch } from 'vue'
import type { Store } from 'rdflib'
import type { NodeShape } from '@/domain/NodeShape'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { serializeGraph } from '@/services/rdf/serializeGraph'
import { classLabelsForSubject, columnsForSubjects, localName, subjectMatchesSearch, thumbnailUrlForSubject, valuesForColumn } from '@/features/browse/browseViewHelpers'
import Message from 'primevue/message'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import SubjectDetailPanel from '@/features/browse/components/SubjectDetailPanel.vue'
import ReviewFilters from '@/features/browse/components/ReviewFilters.vue'
import ReviewGraph from '@/features/browse/components/ReviewGraph.vue'
import ReviewResizeHandle from '@/features/browse/components/ReviewResizeHandle.vue'
import { ReviewQueryIndex, type ReviewQuery } from '@/services/browse/reviewQuery'
import { buildReviewSubgraph } from '@/services/browse/reviewSubgraph'
import { copyText } from '@/services/browser/copyText'

const props = withDefaults(defineProps<{
  model: BrowseModel | null
  generatedStore: Store | null
  browseNodeShapes: readonly NodeShape[]
  browseShapesTurtle: string
  ttlOutput: string
  canBrowse: boolean
  generationError: string | null
  offline?: boolean
  allowExternalImages?: boolean
}>(), { offline: false, allowExternalImages: true })
const { model, generatedStore, browseNodeShapes, browseShapesTurtle, ttlOutput, canBrowse, generationError } = toRefs(props)
const toast = useToast()
const queryIndex = computed(() => generatedStore.value && new ReviewQueryIndex(generatedStore.value, new Map(
  model.value?.groups.flatMap(group => group.subjects.map(subject => [subject.iri, subject.label] as const)) ?? [],
)))
const filteredTurtle = ref('')
const turtleError = ref('')
const isSerializingTurtle = ref(false)

// ---------- View state ----------
const layout = ref<'list' | 'card' | 'graph' | 'ttl'>('list')
const layoutOptions = [
  { value: 'list',  icon: 'pi pi-list',     label: 'List' },
  { value: 'card',  icon: 'pi pi-th-large', label: 'Cards' },
  { value: 'graph', icon: 'pi pi-share-alt', label: 'Graph' },
  { value: 'ttl',   icon: 'pi pi-code',     label: 'TTL' },
]
const search = ref('')
const selectedClass = ref('')
const selectedShapeIri = ref('')
const filterRevision = ref(0)
const shapeQuery = shallowRef<ReviewQuery | null>(null)
const filterShapes = computed(() => browseNodeShapes.value.filter(shape =>
  shape.nodeId.termType === 'NamedNode' && (shape.targetClass?.value ?? shape.nodeId.value) === selectedClass.value,
))
watch(filterShapes, shapes => {
  if (!shapes.some(shape => shape.nodeId.value === selectedShapeIri.value)) selectedShapeIri.value = shapes[0]?.nodeId.value ?? ''
}, { flush: 'sync' })
watch([selectedClass, queryIndex, selectedShapeIri], () => {
  shapeQuery.value = null
  filterRevision.value++
}, { flush: 'sync' })
function onShapeQuery(value: ReviewQuery): void {
  if (value.query.rootShapeId === selectedShapeIri.value) shapeQuery.value = value
}
function clearShapeFilters(): void {
  shapeQuery.value = null
  filterRevision.value++
}

watch(model, () => {
  clearFilters()
  detailSubjectIri.value = null
})

const classOptions = computed(() =>
  (model.value?.groups ?? []).map(group => ({
    value: group.classIri,
    label: group.classLabel,
  })),
)

const classLabelsByIri = computed(() => {
  const labels = new Map<string, string>()
  for (const group of model.value?.groups ?? []) {
    labels.set(group.classIri, group.classLabel)
  }
  return labels
})

const allSubjects = computed<BrowseSubject[]>(() => {
  const deduped: BrowseSubject[] = []
  const seen = new Set<string>()
  for (const group of model.value?.groups ?? []) {
    for (const subject of group.subjects) {
      if (seen.has(subject.iri)) continue
      seen.add(subject.iri)
      deduped.push(subject)
    }
  }
  return deduped
})

const classFilteredSubjects = computed<BrowseSubject[]>(() => {
  if (!selectedClass.value) return allSubjects.value
  return allSubjects.value.filter(subject => subject.classes.includes(selectedClass.value))
})

const textFilteredSubjects = computed(() => {
  const term = search.value.trim().toLowerCase()
  return classFilteredSubjects.value.filter(subject => !term || subjectMatchesSearch(subject, term))
})
const filterRoots = computed(() => {
  const term = search.value.trim().toLowerCase()
  return allSubjects.value.filter(subject => subject.classes.includes(selectedClass.value)
    && (!term || subjectMatchesSearch(subject, term))).map(subject => subject.iri)
})
const shapeMatches = computed(() => shapeQuery.value?.query.criteria.length && queryIndex.value
  ? queryIndex.value.matchingRoots(shapeQuery.value, textFilteredSubjects.value.map(subject => subject.iri)) : null)
const visibleSubjects = computed(() => textFilteredSubjects.value.filter(subject => !shapeMatches.value || shapeMatches.value.has(subject.iri)))

const activeShapeFilters = computed(() => shapeQuery.value?.query.criteria.length ?? 0)
const activeFilterCount = computed(() => Number(Boolean(selectedClass.value)) + activeShapeFilters.value)
const hasActiveFilters = computed(() => Boolean(search.value.trim() || selectedClass.value || activeShapeFilters.value))

const visibleRootIds = computed(() => visibleSubjects.value.map(subject => subject.iri))
watch([layout, visibleRootIds, generatedStore, ttlOutput], async ([view, roots, store, completeTurtle], _previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  if (view !== 'ttl') return
  filteredTurtle.value = ''
  turtleError.value = ''
  isSerializingTurtle.value = false
  if (!store || !roots.length) return
  if (!hasActiveFilters.value) {
    filteredTurtle.value = completeTurtle
    return
  }
  isSerializingTurtle.value = true
  try {
    const selected = new Set(roots)
    const excluded = selectedClass.value
      ? new Set(classFilteredSubjects.value.filter(subject => !selected.has(subject.iri)).map(subject => subject.iri))
      : new Set<string>()
    const turtle = await serializeGraph(buildReviewSubgraph(store, roots, excluded), 'text/turtle')
    if (current) filteredTurtle.value = turtle
  } catch (cause) {
    if (current) turtleError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (current) isSerializingTurtle.value = false
  }
})

const isCopying = ref(false)

function clearFilters(): void {
  search.value = ''
  selectedClass.value = ''
  shapeQuery.value = null
  clearShapeFilters()
}

// ---------- Detail dialog ----------
const detailSubjectIri = ref<string | null>(null)
const workspace = ref<HTMLElement | null>(null)
const workspaceWidth = ref(window.innerWidth - 48)
const viewportWidth = ref(window.innerWidth)
const filterWidth = ref(260)
const detailWidth = ref(390)
const sidebarBudget = computed(() => workspaceWidth.value - 320 - (detailSubjectIri.value && viewportWidth.value > 1000 ? 24 : 12))
const effectiveDetailWidth = computed(() => Math.max(280, Math.min(detailWidth.value, sidebarBudget.value - 180)))
const maxFilterWidth = computed(() => Math.max(180, sidebarBudget.value - (detailSubjectIri.value && viewportWidth.value > 1000 ? effectiveDetailWidth.value : 0)))
const effectiveFilterWidth = computed(() => Math.max(180, Math.min(filterWidth.value, maxFilterWidth.value)))
const maxDetailWidth = computed(() => Math.max(280, sidebarBudget.value - effectiveFilterWidth.value))
let paneObserver: ResizeObserver | undefined
function measureWorkspace(): void {
  viewportWidth.value = window.innerWidth
  if (workspace.value) workspaceWidth.value = workspace.value.getBoundingClientRect().width || window.innerWidth - 48
}
watch(workspace, (element, previous) => {
  if (previous) paneObserver?.unobserve(previous)
  if (element) { paneObserver?.observe(element); measureWorkspace() }
})
onMounted(() => {
  paneObserver = new ResizeObserver(measureWorkspace)
  if (workspace.value) paneObserver.observe(workspace.value)
  measureWorkspace()
  window.addEventListener('resize', measureWorkspace)
})
onBeforeUnmount(() => { paneObserver?.disconnect(); window.removeEventListener('resize', measureWorkspace) })

function openDetail(subj: BrowseSubject): void {
  detailSubjectIri.value = subj.iri
}

// ---------- List-view pivot ----------
const listColumns = computed(() =>
  selectedClass.value ? columnsForSubjects(visibleSubjects.value) : [],
)
const hasThumbnails = computed(() => props.allowExternalImages && visibleSubjects.value.some(subject => Boolean(thumbnailUrlForSubject(subject))))

function classLabelsFor(subject: BrowseSubject): string[] {
  return classLabelsForSubject(subject, classLabelsByIri.value)
}

function thumbnailUrl(subject: BrowseSubject): string | undefined {
  return props.allowExternalImages ? thumbnailUrlForSubject(subject) : undefined
}

function subjectId(subject: BrowseSubject): string {
  return localName(subject.iri)
}

async function copyTurtle(): Promise<void> {
  if (!filteredTurtle.value || isSerializingTurtle.value || turtleError.value) return
  isCopying.value = true
  try {
    await copyText(filteredTurtle.value)
    toast.add({ severity: 'success', summary: 'Copied', detail: 'Turtle copied to the clipboard.', life: 2500 })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Copy failed', detail: err instanceof Error ? err.message : String(err), life: 4000 })
  } finally {
    isCopying.value = false
  }
}

</script>

<template>
  <div class="browse-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Review</h1>
        <p class="page-subtitle">Inspect generated RDF as a list, cards, a connected graph, or raw Turtle.</p>
      </div>
    </header>

    <Message v-if="!canBrowse" severity="warn" :closable="false">
      Load source data to review generated RDF. Profiles and explicit mappings remain optional while staging mappings are active.
    </Message>

    <Message v-if="generationError" severity="error" :closable="false">
      {{ generationError }}
    </Message>

    <div v-if="canBrowse && model" ref="workspace" class="review-workspace" :class="{ 'has-details': detailSubjectIri }" :style="{ '--review-filter-width': `${effectiveFilterWidth}px`, '--review-detail-width': `${effectiveDetailWidth}px` }">
      <aside class="review-sidebar" aria-labelledby="review-filters-title">
        <header class="review-sidebar-header">
          <h2 id="review-filters-title">Filters<span v-if="activeFilterCount"> ({{ activeFilterCount }})</span></h2>
          <Button class="clear-filters" label="Clear" size="small" text :disabled="!hasActiveFilters" @click="clearFilters" />
        </header>
        <label class="search-filter form-stack">
          <span>Search</span>
          <span class="search-wrapper">
            <i class="pi pi-search" aria-hidden="true" />
            <InputText v-model="search" placeholder="Search entities..." class="search-input" />
          </span>
        </label>
        <label class="class-filter form-stack">
          <span>Entity type</span>
          <select v-model="selectedClass" class="form-select" aria-label="Class to filter">
            <option value="">All types</option>
            <option v-for="option in classOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="filterShapes.length > 1" class="form-stack profile-filter">
          <span>Filter profile</span>
          <select v-model="selectedShapeIri" class="form-select" aria-label="Filter profile">
            <option v-for="shape in filterShapes" :key="shape.nodeId.value" :value="shape.nodeId.value" :title="shape.nodeId.value">
              {{ shape.rdfsLabel ?? shape.label ?? localName(shape.nodeId.value) }}
            </option>
          </select>
        </label>
        <section class="review-shape-filters" aria-labelledby="review-property-filters-title">
          <div class="review-property-heading">
            <h3 id="review-property-filters-title">Properties</h3>
            <button v-if="activeShapeFilters" type="button" class="link-button clear-shape-filters" @click="clearShapeFilters">Reset</button>
          </div>
          <ReviewFilters
            v-if="selectedShapeIri && queryIndex"
            :key="`${selectedShapeIri}:${filterRevision}`"
            :shapes-turtle="browseShapesTurtle"
            :shape-iri="selectedShapeIri"
            :index="queryIndex"
            :roots="filterRoots"
            @query="onShapeQuery"
          />
          <p v-else class="filter-help">{{ selectedClass ? 'No SHACL profile is available for this type. Search and type filters still apply.' : 'Choose an entity type to filter its properties using its SHACL profile.' }}</p>
        </section>
      </aside>
      <ReviewResizeHandle
        class="filter-resize-handle" label="Resize filters" :value="effectiveFilterWidth" :min="180" :max="maxFilterWidth" :default-value="260"
        @update:value="value => filterWidth = value"
      />
      <section class="review-results" aria-label="Review results">
        <div class="results-toolbar">
          <div class="results-heading">
            <h2>Results</h2>
            <p class="review-summary" role="status"><span v-if="selectedClass">{{ classLabelsByIri.get(selectedClass) }} &middot; </span>{{ visibleSubjects.length.toLocaleString() }} of {{ classFilteredSubjects.length.toLocaleString() }} subjects</p>
          </div>
          <SelectButton
            v-model="layout"
            :options="layoutOptions"
            :allow-empty="false"
            option-label="label"
            option-value="value"
            aria-label="Review layout"
          >
            <template #option="slotProps">
              <i :class="slotProps.option.icon" aria-hidden="true" />
              <span class="layout-label">{{ slotProps.option.label }}</span>
            </template>
          </SelectButton>
        </div>
        <p v-if="layout === 'ttl' && hasActiveFilters" class="turtle-filter-note">Turtle includes matching subjects and their linked entities.</p>

        <!-- Empty state -->
        <Message v-if="visibleSubjects.length === 0" severity="info" :closable="false">
          No subjects match the current filters.
        </Message>

        <ReviewGraph
          v-if="layout === 'graph'"
          :model="model"
          :subjects="visibleSubjects"
          :selected-iri="detailSubjectIri"
          @open-subject="iri => openDetail({ iri, label: '', classes: [], properties: [] })"
        />

        <section v-else-if="layout === 'ttl'" class="ttl-view">
          <Message v-if="turtleError" severity="error" :closable="false">{{ turtleError }}</Message>
          <p v-if="isSerializingTurtle" role="status">Preparing Turtle…</p>
          <div class="ttl-actions">
            <Button
              icon="pi pi-copy"
              label="Copy"
              size="small"
              severity="secondary"
              outlined
              :loading="isCopying"
              :disabled="isSerializingTurtle || Boolean(turtleError) || !filteredTurtle"
              @click="copyTurtle"
            />
          </div>
          <pre class="ttl-output" :aria-busy="isSerializingTurtle">{{ filteredTurtle }}</pre>
        </section>

        <section v-else-if="layout === 'card'" class="card-grid" aria-label="Subject cards">
          <article
            v-for="subject in visibleSubjects"
            :key="subject.iri"
            class="subject-card"
            :class="{ 'is-selected': detailSubjectIri === subject.iri }"
            tabindex="0"
            role="button"
            @keydown.enter="openDetail(subject)"
            @keydown.space.prevent="openDetail(subject)"
            @click="openDetail(subject)"
          >
            <div class="subject-card__media">
              <img
                v-if="thumbnailUrl(subject)"
                :src="thumbnailUrl(subject)"
                :alt="`Thumbnail for ${subject.label}`"
                class="subject-card__thumbnail"
                loading="lazy"
              >
              <div v-else class="subject-card__thumbnail subject-card__thumbnail--empty" aria-hidden="true" />
            </div>
            <div class="subject-card__body">
              <div class="subject-card__label">{{ subject.label }}</div>
              <div class="subject-card__meta mono-meta">{{ subjectId(subject) }}</div>
              <div class="subject-card__classes">
                <Tag
                  v-for="classLabel in classLabelsFor(subject)"
                  :key="`${subject.iri}-card-${classLabel}`"
                  :value="classLabel"
                  severity="info"
                />
              </div>
            </div>
          </article>
        </section>

        <!-- List layout (pivot) -->
        <div v-else class="list-table-wrapper">
          <table class="list-table data-table">
            <thead>
              <tr>
                <th class="col-label">
                  <div class="cell-label-layout cell-label-layout--header">
                    <span v-if="hasThumbnails" class="record-thumbnail-heading" aria-hidden="true" />
                    <div class="cell-label-copy">
                      <div class="col-name">Label</div>
                      <div class="col-path mono-meta">@id</div>
                    </div>
                  </div>
                </th>
                <th class="col-label">
                  <div class="col-name">Classes</div>
                  <div class="col-path mono-meta">rdf:type</div>
                </th>
                <th
                  v-for="col in listColumns"
                  :key="col.predicate"
                  :title="col.predicate"
                >
                  <div class="col-name">{{ col.label }}</div>
                  <div class="col-path mono-meta">{{ col.predicate }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="subject in visibleSubjects"
                :key="subject.iri"
                class="clickable-row"
                :class="{ 'is-selected': detailSubjectIri === subject.iri }"
                :aria-selected="detailSubjectIri === subject.iri"
                tabindex="0"
                @keydown.enter="openDetail(subject)"
                @click="openDetail(subject)"
              >
                <td class="cell-label">
                  <div class="cell-label-layout">
                    <img
                      v-if="thumbnailUrl(subject)"
                      :src="thumbnailUrl(subject)"
                      :alt="`Thumbnail for ${subject.label}`"
                      class="record-thumbnail"
                      loading="lazy"
                    >
                    <span v-else-if="hasThumbnails" class="record-thumbnail-slot" aria-hidden="true" />
                    <div class="cell-label-copy">
                      <div class="cell-name">{{ subject.label }}</div>
                      <div class="cell-iri mono-meta" :title="subject.iri">{{ localName(subject.iri) }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="class-chip-row">
                    <Tag
                      v-for="classLabel in classLabelsFor(subject)"
                      :key="`${subject.iri}-${classLabel}`"
                      :value="classLabel"
                      severity="info"
                    />
                  </div>
                </td>
                <td
                  v-for="col in listColumns"
                  :key="col.predicate"
                >
                  <div
                    v-for="(property, idx) in valuesForColumn(subject, col.predicate)"
                    :key="idx"
                    class="cell-value"
                  >
                    <button
                      v-if="property.isResource && property.resolvedLabel"
                      class="ref-btn link-button"
                      :title="property.value"
                      @click.stop="openDetail({ iri: property.value, label: property.resolvedLabel, classes: [], properties: [] })"
                    >
                      {{ property.resolvedLabel }}
                    </button>
                    <a v-else-if="property.isResource" :href="property.value" target="_blank" rel="noopener" :title="property.value" @click.stop>
                      {{ localName(property.value) }}
                    </a>
                    <span v-else>{{ property.value }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <ReviewResizeHandle
        v-if="detailSubjectIri" class="detail-resize-handle" label="Resize entity details" :value="effectiveDetailWidth" :min="280" :max="maxDetailWidth" :default-value="390" reverse
        @update:value="value => detailWidth = value"
      />
      <SubjectDetailPanel
        v-if="detailSubjectIri"
        :subject-iri="detailSubjectIri"
        :model="model"
        :shapes="browseNodeShapes"
        :shapes-turtle="browseShapesTurtle"
        :values-turtle="ttlOutput"
        :offline="offline"
        :allow-external-images="allowExternalImages"
        @close="detailSubjectIri = null"
        @open-subject="iri => detailSubjectIri = iri"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.browse-view {
  width: 100%; height: 100%; min-height: 0; padding: var(--space-4) var(--space-5);
  display: flex; flex-direction: column; gap: var(--space-4); overflow: hidden;
}
.page-header { flex-shrink: 0; }
.review-workspace { display: grid; grid-template-columns: var(--review-filter-width) 12px minmax(0, 1fr); gap: 0; flex: 1; min-height: 0; }
.review-workspace.has-details { grid-template-columns: var(--review-filter-width) 12px minmax(0, 1fr) 12px var(--review-detail-width); }
.review-sidebar { display: flex; flex-direction: column; gap: var(--space-4); min-height: 0; overflow: auto; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
.review-sidebar-header, .review-property-heading, .results-toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.review-sidebar h2, .results-toolbar h2 { margin: 0; font-size: 1rem; }
.review-sidebar h3 { margin: 0; font-size: 0.875rem; }
.review-shape-filters { border-top: 1px solid var(--color-border); padding-top: var(--space-4); }
.review-property-heading { margin-bottom: var(--space-3); }
.filter-help { color: var(--color-text-muted); font-size: 0.875rem; line-height: 1.6; margin: 0; }
.review-results { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; min-height: 0; overflow: hidden; }
.results-toolbar { flex-shrink: 0; flex-wrap: wrap; padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); }
.results-heading { display: grid; gap: var(--space-1); }
.turtle-filter-note { margin: 0; color: var(--color-text-muted); font-size: 0.75rem; }
.search-wrapper { width: 100%; position: relative; display: flex; align-items: center;
  i { position: absolute; left: 0.75rem; color: var(--color-text-muted); pointer-events: none; }
  .search-input { padding-left: 2.25rem; width: 100%; min-width: 0; }
}
.form-select { width: 100%; min-width: 0; }
.layout-label { margin-left: var(--space-1); }
.review-summary { margin: 0; color: var(--color-text-muted); font-size: 0.85rem; flex-shrink: 0; }
@media (max-width: 1200px) {
  .review-sidebar, .review-results { padding: var(--space-3); }
}
@media (max-width: 1000px) {
  .review-workspace.has-details { grid-template-columns: var(--review-filter-width) 12px minmax(0, 1fr); }
  .detail-resize-handle { display: none; }
  .review-workspace.has-details > .subject-detail-panel { grid-column: 1 / -1; max-height: 60vh; min-height: 300px; }
  .review-workspace.has-details { overflow: auto; }
}
@media (max-width: 850px) {
  .browse-view { overflow: auto; padding: var(--space-4); }
  .review-workspace, .review-workspace.has-details { grid-template-columns: 1fr; min-height: auto; }
  .filter-resize-handle { display: none; }
  .review-sidebar { max-height: 42vh; }
  .review-results { min-height: 550px; }
}

.ttl-view {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.ttl-actions {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 1;
}
.group-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
  h2 { margin: 0; font-size: 1.15rem; }
  .group-iri { font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted); margin-left: auto; }
}
.ttl-header { border-bottom: 1px solid var(--color-border); }

.class-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.list-table-wrapper {
  overflow: auto;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.list-table {
  font-size: 0.875rem;
  td, th { padding: var(--space-2) var(--space-3); vertical-align: middle; }
  th {
    background: var(--color-bg);
  }
}
.col-name { font-weight: 600; }
.col-path {
  font-weight: 400;
  margin-top: 2px;
  word-break: break-all;
}
.cell-label-layout--header {
  align-items: flex-start;
}
.cell-label-layout {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.cell-label-copy {
  min-width: 0;
}
.cell-label .cell-name { font-weight: 500; }
.cell-iri { max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; }
.is-selected { background: var(--color-accent-soft); }
.subject-card.is-selected { border-color: var(--color-primary); }
.clickable-row:focus-visible, .subject-card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.record-thumbnail-slot {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
}
.record-thumbnail-heading { width: 36px; flex: 0 0 36px; }
.record-thumbnail {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  object-fit: contain;
  object-position: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
}
.cell-value {
  word-break: break-word;
  & + .cell-value { margin-top: 2px; }
  a { color: var(--color-primary); text-decoration: none; &:hover { text-decoration: underline; } }
}

.clickable-row {
  cursor: pointer;
  transition: background-color 0.15s;
  &:hover { background: var(--color-surface-1); }
}

.card-grid {
  overflow: auto;
  align-content: start;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}

.subject-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: var(--color-primary);
    box-shadow: var(--shadow-sm);
  }
}

.subject-card__media {
  width: 100%;
}

.subject-card__thumbnail {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: contain;
  object-position: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  display: block;
}

.subject-card__thumbnail--empty {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-surface-1) 92%, #ffffff 8%), var(--color-surface-1));
}

.subject-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.subject-card__label {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.35;
}

.subject-card__meta {
  color: var(--color-text-muted);
  font-size: 0.8rem;
  word-break: break-word;
}

.subject-card__classes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ttl-details {
  margin-top: var(--space-4);
  summary { cursor: pointer; color: var(--color-text-muted); font-size: 0.85rem; padding: var(--space-2) 0; }
}
.ttl-output {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: calc(var(--space-3) + 2.75rem) var(--space-3) var(--space-3);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow: auto;
  white-space: pre;
  margin: 0;
}
</style>
