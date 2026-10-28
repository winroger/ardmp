<script setup lang="ts">
/**
 * BrowseView — list and Turtle view over generated RDF subjects.
 *
 * On mount: regenerates RDF automatically from the current mapping.
 *
 * Cross-references between subjects are rendered with the referenced
 * subject's resolved label (resolvedLabel from browseService) instead
 * of raw IRIs, so a card that points to "recF60FgOJh6JERc" actually
 * shows "Bosch Capdeferro Architecture".
 *
 * The list view pivots properties into table columns: each unique
 * predicate within the currently visible subject set becomes a column
 * whose header shows the human label on top and the property path underneath.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { Store } from 'rdflib'
import { isCanvasVisibleDataSource } from '@/domain/DataSource'
import type { NodeShape } from '@/domain/NodeShape'
import { useShapesStore } from '@/stores/shapesStore'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'
import { buildBrowseModel, type BrowseModel, type BrowseSubject } from '@/services/browse/browseService'
import { buildRuntimeStagingShapes, type RuntimeStagingShapes } from '@/services/mapping/stagingShapes'
import {
  classLabelsForSubject,
  columnsForSubjects,
  localName,
  subjectMatchesSearch,
  thumbnailUrlForSubject,
  valuesForColumn,
} from '@/features/browse/browseViewHelpers'
import Message from 'primevue/message'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import SubjectDetailDialog from '@/features/browse/components/SubjectDetailDialog.vue'
import ReviewFilters from '@/features/browse/components/ReviewFilters.vue'
import { ReviewQueryIndex, type ReviewQuery } from '@/services/browse/reviewQuery'
import { buildReviewSubgraph } from '@/services/browse/reviewSubgraph'

const shapesStore = useShapesStore()
const dataStore = useDataStore()
const mappingStore = useMappingStore()
const toast = useToast()
const { ap, hasShapes, nodeShapes, profiles } = storeToRefs(shapesStore)
const { sources } = storeToRefs(dataStore)

/**
 * Combined raw Turtle of every loaded data-shape profile. Passed to the
 * `<shacl-form>` web component as `data-shapes` for the detail dialog.
 */
const combinedShapesTurtle = computed(() =>
  profiles.value.map(p => p.rawTurtle).join('\n\n'),
)

function createEmptyRuntimeStagingShapes(): RuntimeStagingShapes {
  return {
    profile: null,
    nodeShapes: [],
    turtle: '',
  }
}

const runtimeStagingShapes = ref<RuntimeStagingShapes>(createEmptyRuntimeStagingShapes())

const browseNodeShapes = computed<readonly NodeShape[]>(() => [
  ...nodeShapes.value,
  ...runtimeStagingShapes.value.nodeShapes,
])

const browseShapesTurtle = computed(() =>
  [combinedShapesTurtle.value, runtimeStagingShapes.value.turtle].filter(Boolean).join('\n\n'),
)

const canBrowse = computed(() =>
  sources.value.some(source => isCanvasVisibleDataSource(source))
  || (hasShapes.value && sources.value.length > 0 && mappingStore.state.hasMappings),
)

// ---------- RDF + validation, auto-built from current state ----------
const model = ref<BrowseModel | null>(null)
const queryIndex = shallowRef<ReviewQueryIndex | null>(null)
const generatedStore = shallowRef<Store | null>(null)
const ttlOutput = ref('')
const filteredTurtle = ref('')
const turtleError = ref('')
const isSerializingTurtle = ref(false)
const generationError = ref<string | null>(null)
const isGenerating = ref(false)

async function regenerate(): Promise<void> {
  if (!canBrowse.value) {
    runtimeStagingShapes.value = createEmptyRuntimeStagingShapes()
    model.value = null
    queryIndex.value = null
    generatedStore.value = null
    ttlOutput.value = ''
    generationError.value = null
    return
  }
  isGenerating.value = true
  generationError.value = null
  try {
    const nextRuntimeStagingShapes = buildRuntimeStagingShapes(
      sources.value,
      mappingStore.state,
      nodeShapes.value,
    )
    runtimeStagingShapes.value = nextRuntimeStagingShapes

    const result = generateRdf(ap.value, mappingStore.state, sources.value)
    generatedStore.value = result.store
    model.value = buildBrowseModel(
      result.store,
      [...nodeShapes.value, ...nextRuntimeStagingShapes.nodeShapes],
      sources.value,
    )
    queryIndex.value = new ReviewQueryIndex(result.store, new Map(
      model.value.groups.flatMap(group => group.subjects.map(subject => [subject.iri, subject.label] as const)),
    ))
    ttlOutput.value = await serializeGraph(result.store, 'text/turtle')
  } catch (err) {
    generationError.value = err instanceof Error ? err.message : String(err)
    runtimeStagingShapes.value = createEmptyRuntimeStagingShapes()
    model.value = null
    queryIndex.value = null
    generatedStore.value = null
    ttlOutput.value = ''
  } finally {
    isGenerating.value = false
  }
}

onMounted(regenerate)
// Re-run if the underlying data changes while the view is mounted.
watch(
  [
    () => sources.value.length,
    () => sources.value.map(s => s.id).join('|'),
    () => nodeShapes.value.length,
    () => mappingStore.state.edges.length,
    () => JSON.stringify(mappingStore.state.subjectIdentifiers),
    () => JSON.stringify(mappingStore.state.stagingColumns.inactiveColumnsBySource),
  ],
  regenerate,
)

// ---------- View state ----------
const layout = ref<'list' | 'card' | 'ttl'>('list')
const layoutOptions = [
  { value: 'list',  icon: 'pi pi-list',     label: 'List' },
  { value: 'card',  icon: 'pi pi-th-large', label: 'Cards' },
  { value: 'ttl',   icon: 'pi pi-code',     label: 'TTL' },
]
const search = ref('')
const selectedClass = ref('')
const draftClass = ref('')
const selectedShapeIri = ref('')
const filtersOpen = ref(false)
const filterDialog = ref<HTMLDialogElement | null>(null)
const filterForm = ref<InstanceType<typeof ReviewFilters> | null>(null)
const filterRevision = ref(0)
const shapeQuery = shallowRef<ReviewQuery | null>(null)
const draftShapeQuery = shallowRef<ReviewQuery | null>(null)
const filterShapes = computed(() => browseNodeShapes.value.filter(shape =>
  shape.nodeId.termType === 'NamedNode' && (shape.targetClass?.value ?? shape.nodeId.value) === draftClass.value,
))
watch(filterShapes, shapes => {
  if (!shapes.some(shape => shape.nodeId.value === selectedShapeIri.value)) selectedShapeIri.value = shapes[0]?.nodeId.value ?? ''
}, { flush: 'sync' })
watch([draftClass, queryIndex], () => {
  draftShapeQuery.value = null
  filterRevision.value++
}, { flush: 'sync' })
watch(selectedShapeIri, () => {
  draftShapeQuery.value = null
  filterRevision.value++
}, { flush: 'sync' })

function openFilters(): void {
  filtersOpen.value = true
  filterDialog.value?.showModal()
}

function closeFilters(): void {
  filtersOpen.value = false
  filterDialog.value?.close()
}

function onShapeQuery(value: ReviewQuery): void {
  if (value.query.rootShapeId === selectedShapeIri.value) draftShapeQuery.value = value
}

function applyFilters(): void {
  if (!draftClass.value) return
  const latestQuery = filterForm.value?.getQuery?.() ?? draftShapeQuery.value
  selectedClass.value = draftClass.value
  shapeQuery.value = latestQuery?.query.rootShapeId === selectedShapeIri.value ? latestQuery : null
  closeFilters()
}

function clearShapeFilters(): void {
  draftShapeQuery.value = null
  filterRevision.value++
}

watch(model, () => {
  clearFilters()
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
  return allSubjects.value.filter(subject => subject.classes.includes(draftClass.value)
    && (!term || subjectMatchesSearch(subject, term))).map(subject => subject.iri)
})
const shapeMatches = computed(() => shapeQuery.value?.query.criteria.length && queryIndex.value
  ? queryIndex.value.matchingRoots(shapeQuery.value, textFilteredSubjects.value.map(subject => subject.iri)) : null)
const visibleSubjects = computed(() => textFilteredSubjects.value.filter(subject => !shapeMatches.value || shapeMatches.value.has(subject.iri)))

const activeShapeFilters = computed(() => shapeQuery.value?.query.criteria.length ?? 0)
const draftShapeFilters = computed(() => draftShapeQuery.value?.query.criteria.length ?? 0)
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
  draftClass.value = ''
  clearShapeFilters()
  closeFilters()
}

// ---------- Detail dialog ----------
const detailOpen = ref(false)
const detailSubjectIri = ref<string | null>(null)

function openDetail(subj: BrowseSubject): void {
  detailSubjectIri.value = subj.iri
  detailOpen.value = true
}

// ---------- List-view pivot ----------
const listColumns = computed(() =>
  selectedClass.value ? columnsForSubjects(visibleSubjects.value) : [],
)

function classLabelsFor(subject: BrowseSubject): string[] {
  return classLabelsForSubject(subject, classLabelsByIri.value)
}

function thumbnailUrl(subject: BrowseSubject): string | undefined {
  return thumbnailUrlForSubject(subject)
}

function subjectId(subject: BrowseSubject): string {
  return localName(subject.iri)
}

async function copyTurtle(): Promise<void> {
  if (!filteredTurtle.value || isSerializingTurtle.value || turtleError.value) return
  isCopying.value = true
  try {
    await navigator.clipboard.writeText(filteredTurtle.value)
    toast.add({ severity: 'success', summary: 'Copied', detail: 'Turtle copied to the clipboard.', life: 2500 })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Copy failed', detail: err instanceof Error ? err.message : String(err), life: 4000 })
  } finally {
    isCopying.value = false
  }
}

</script>

<template>
  <div class="browse-view" :class="{ 'is-ttl-layout': layout === 'ttl' }">
    <header class="page-header">
      <div>
        <h1 class="page-title">Review</h1>
        <p class="page-subtitle">Inspect the generated RDF subjects as a flat list or raw Turtle.</p>
      </div>
    </header>

    <Message v-if="!canBrowse" severity="warn" :closable="false">
      Load source data to review generated RDF. Profiles and explicit mappings remain optional while staging mappings are active.
    </Message>

    <Message v-if="generationError" severity="error" :closable="false">
      {{ generationError }}
    </Message>

    <template v-if="canBrowse && model">
      <!-- Filter toolbar -->
      <div class="toolbar">
        <label class="search-filter form-stack">
          <span>Search</span>
          <span class="p-input-icon-left search-wrapper">
            <i class="pi pi-search" aria-hidden="true" />
            <InputText v-model="search" placeholder="Search subjects and properties..." class="search-input" />
          </span>
        </label>
        <label class="view-filter form-stack">
          <span>View</span>
          <SelectButton
            v-model="layout"
            :options="layoutOptions"
            option-label="label"
            option-value="value"
            aria-label="Review layout"
          >
            <template #option="slotProps">
              <i :class="slotProps.option.icon" />
              <span class="layout-label">{{ slotProps.option.label }}</span>
            </template>
          </SelectButton>
        </label>

        <button
          type="button"
          class="shape-filter-toggle"
          :aria-expanded="filtersOpen"
          aria-haspopup="dialog"
          aria-controls="review-filter-dialog"
          @click="openFilters"
        >
          <i class="pi pi-filter" aria-hidden="true" />
          Filters<span v-if="activeFilterCount"> ({{ activeFilterCount }})</span>
        </button>

      </div>

      <dialog
        id="review-filter-dialog"
        ref="filterDialog"
        class="filter-dialog"
        aria-labelledby="review-filter-title"
        aria-describedby="review-filter-description"
        @close="filtersOpen = false"
      >
        <header class="filter-dialog-header">
          <h2 id="review-filter-title">Filters</h2>
          <button type="button" class="filter-dialog-close" aria-label="Close filters" @click="closeFilters"><i class="pi pi-times" aria-hidden="true" /></button>
        </header>
        <div class="filter-dialog-body">
          <p id="review-filter-description">Choose a class, then filter its properties and linked records.</p>
          <label class="class-filter form-stack">
            <span>Class <span aria-hidden="true">*</span></span>
            <select v-model="draftClass" class="form-select" aria-label="Class to filter" required>
              <option value="" disabled>Select a class</option>
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
          <button v-if="draftShapeFilters" type="button" class="link-button clear-shape-filters" @click="clearShapeFilters">Clear shape filters</button>
          <ReviewFilters
            v-if="selectedShapeIri && queryIndex"
            :key="`${selectedShapeIri}:${filterRevision}`"
            ref="filterForm"
            :shapes-turtle="browseShapesTurtle"
            :shape-iri="selectedShapeIri"
            :index="queryIndex"
            :roots="filterRoots"
            @query="onShapeQuery"
          />
          <p v-else-if="draftClass">No filter profile is available for this class. You can filter by class and text.</p>
        </div>
        <footer class="filter-dialog-footer">
          <Button label="Clear filters" severity="secondary" outlined :disabled="!hasActiveFilters && !draftClass" @click="clearFilters" />
          <div class="filter-dialog-actions">
            <Button label="Close" severity="secondary" outlined @click="closeFilters" />
            <Button class="apply-filters" label="Apply filters" :disabled="!draftClass" @click="applyFilters" />
          </div>
        </footer>
      </dialog>

      <p class="review-summary" role="status">
        <span v-if="selectedClass">{{ classLabelsByIri.get(selectedClass) }} · </span>{{ visibleSubjects.length }} of {{ classFilteredSubjects.length }} subjects
        <span v-if="layout === 'ttl' && hasActiveFilters"> · Turtle includes matching subjects and their linked entities.</span>
      </p>

      <!-- Empty state -->
      <Message v-if="visibleSubjects.length === 0" severity="info" :closable="false">
        No subjects match the current filters.
      </Message>

      <section v-if="layout === 'ttl'" class="ttl-view">
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
                  <span class="record-thumbnail-slot" aria-hidden="true" />
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
                  <span v-else class="record-thumbnail-slot" aria-hidden="true" />
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
    </template>

    <!-- Subject detail dialog (shacl-form viewer) -->
    <SubjectDetailDialog
      v-model="detailOpen"
      :subject-iri="detailSubjectIri"
      :model="model"
      :shapes="browseNodeShapes"
      :shapes-turtle="browseShapesTurtle"
      :values-turtle="ttlOutput"
    />
  </div>
</template>

<style scoped lang="scss">
.browse-view {
  max-width: 1440px;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow: auto;
}

.browse-view.is-ttl-layout {
  box-sizing: border-box;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.search-filter,
.class-filter,
.view-filter {
}

.search-filter {
  flex: 1 1 280px;
  min-width: 240px;
}

.search-wrapper {
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;
  i { position: absolute; left: 0.75rem; color: var(--color-text-muted); pointer-events: none; }
  .search-input { padding-left: 2.25rem; width: 100%; }
}

.class-filter,
.view-filter {
  min-width: 220px;
}

.layout-label { margin-left: var(--space-1); }
.shape-filter-toggle {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.filter-dialog {
  width: min(850px, calc(100vw - 2rem));
  max-height: calc(100dvh - 3rem);
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  &::backdrop { background: rgb(15 23 42 / 45%); }
  &[open] { display: flex; flex-direction: column; }
}
.filter-dialog-header, .filter-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  flex-shrink: 0;
}
.filter-dialog-header {
  border-bottom: 1px solid var(--color-border);
  h2 { margin: 0; font-size: 1.2rem; }
}
.filter-dialog-close { border: 0; padding: 0.5rem; background: none; color: inherit; cursor: pointer; }
.filter-dialog-body {
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  p { margin: 0; color: var(--color-text-muted); }
  .search-filter { flex: initial; min-width: 0; }
}
.filter-dialog-footer { border-top: 1px solid var(--color-border); flex-wrap: wrap; }
.filter-dialog-actions { display: flex; gap: var(--space-2); margin-left: auto; }
.clear-shape-filters { align-self: flex-start; }
.review-summary { margin: 0; color: var(--color-text-muted); font-size: 0.85rem; }

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
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.list-table {
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
  align-items: flex-start;
  gap: var(--space-3);
}
.cell-label-copy {
  min-width: 0;
}
.cell-label .cell-name { font-weight: 500; }
.record-thumbnail-slot {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
}
.record-thumbnail {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
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


