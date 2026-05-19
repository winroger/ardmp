<script setup lang="ts">
/**
 * BrowseView — card, list, and Turtle view over generated RDF subjects.
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
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useShapesStore } from '@/stores/shapesStore'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'
import { buildBrowseModel, type BrowseModel, type BrowseSubject } from '@/services/browse/browseService'
import {
  classLabelsForSubject,
  columnsForSubjects,
  localName,
  subjectMatchesSearch,
  valuesForColumn,
} from '@/features/browse/browseViewHelpers'
import Message from 'primevue/message'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import SubjectDetailDialog from '@/features/browse/components/SubjectDetailDialog.vue'

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

const canBrowse = computed(() =>
  hasShapes.value && sources.value.length > 0 && mappingStore.state.hasMappings,
)

// ---------- RDF + validation, auto-built from current state ----------
const model = ref<BrowseModel | null>(null)
const ttlOutput = ref('')
const generationError = ref<string | null>(null)
const isGenerating = ref(false)

async function regenerate(): Promise<void> {
  if (!canBrowse.value) {
    model.value = null
    ttlOutput.value = ''
    return
  }
  isGenerating.value = true
  generationError.value = null
  try {
    const result = generateRdf(ap.value, mappingStore.state, sources.value)
    model.value = buildBrowseModel(result.store, nodeShapes.value)
    ttlOutput.value = await serializeGraph(result.store, 'text/turtle')
  } catch (err) {
    generationError.value = err instanceof Error ? err.message : String(err)
    model.value = null
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
  ],
  regenerate,
)

// ---------- View state ----------
const layout = ref<'cards' | 'list' | 'ttl'>('cards')
const layoutOptions = [
  { value: 'cards', icon: 'pi pi-th-large', label: 'Cards' },
  { value: 'list',  icon: 'pi pi-list',     label: 'List' },
  { value: 'ttl',   icon: 'pi pi-code',     label: 'TTL' },
]
const search = ref('')
const selectedClass = ref('')

watch(model, () => {
  search.value = ''
  selectedClass.value = ''
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

const visibleSubjects = computed(() => {
  const term = search.value.trim().toLowerCase()
  return classFilteredSubjects.value.filter(subject => !term || subjectMatchesSearch(subject, term))
})

const hasActiveFilters = computed(() => Boolean(search.value || selectedClass.value))

const isCopying = ref(false)

function clearFilters(): void {
  search.value = ''
  selectedClass.value = ''
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

async function copyTurtle(): Promise<void> {
  if (!ttlOutput.value) return
  isCopying.value = true
  try {
    await navigator.clipboard.writeText(ttlOutput.value)
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
    <header class="view-header">
      <div>
        <h1>Browse</h1>
        <p class="subtitle">Inspect the generated RDF subjects as cards, a flat list, or raw Turtle.</p>
      </div>
    </header>

    <Message v-if="!canBrowse" severity="warn" :closable="false">
      Load profiles, data, and at least one mapping to browse generated data.
    </Message>

    <Message v-if="generationError" severity="error" :closable="false">
      {{ generationError }}
    </Message>

    <template v-if="canBrowse && model">
      <!-- Filter toolbar -->
      <div class="toolbar">
        <label class="search-filter">
          <span>Search</span>
          <span class="p-input-icon-left search-wrapper">
            <i class="pi pi-search" />
            <InputText
              v-model="search"
              placeholder="Search across subjects and properties..."
              class="search-input"
            />
          </span>
        </label>

        <label class="class-filter">
          <span>Class</span>
          <select v-model="selectedClass">
            <option value="">All classes</option>
            <option v-for="option in classOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="view-filter">
          <span>View</span>
          <SelectButton
            v-model="layout"
            :options="layoutOptions"
            option-label="label"
            option-value="value"
            aria-label="Browse layout"
          >
            <template #option="slotProps">
              <i :class="slotProps.option.icon" />
              <span class="layout-label">{{ slotProps.option.label }}</span>
            </template>
          </SelectButton>
        </label>

        <Button
          v-if="hasActiveFilters"
          icon="pi pi-filter-slash"
          label="Reset filters"
          size="small"
          severity="secondary"
          outlined
          @click="clearFilters"
        />

        <Button
          v-if="layout === 'ttl'"
          icon="pi pi-copy"
          label="Copy Turtle"
          size="small"
          severity="secondary"
          outlined
          :loading="isCopying"
          @click="copyTurtle"
        />

      </div>

      <!-- Empty state -->
      <Message v-if="layout !== 'ttl' && visibleSubjects.length === 0" severity="info" :closable="false">
        No subjects match the current filters.
      </Message>

      <section v-if="layout === 'ttl'" class="ttl-view">
        <header class="group-header ttl-header">
          <h2>Turtle Graph</h2>
        </header>
        <pre class="ttl-output">{{ ttlOutput }}</pre>
      </section>

      <!-- Card layout -->
      <div v-else-if="layout === 'cards'" class="cards">
        <article
          v-for="subject in visibleSubjects"
          :key="subject.iri"
          class="card clickable"
          tabindex="0"
          role="button"
          @click="openDetail(subject)"
          @keydown.enter="openDetail(subject)"
          @keydown.space.prevent="openDetail(subject)"
        >
          <header class="card-header">
            <h3 :title="subject.iri">{{ subject.label }}</h3>
            <span class="card-iri" :title="subject.iri">{{ localName(subject.iri) }}</span>
          </header>
          <div class="subject-classes">
            <Tag v-for="classLabel in classLabelsFor(subject)" :key="`${subject.iri}-${classLabel}`" :value="classLabel" severity="info" />
          </div>
          <dl v-if="subject.properties.length > 0" class="props">
            <template v-for="(property, idx) in subject.properties" :key="`${subject.iri}-${idx}`">
              <dt :title="property.predicate">{{ property.label }}</dt>
              <dd>
                <button
                  v-if="property.isResource && property.resolvedLabel"
                  class="ref-btn"
                  :title="property.value"
                  @click.stop="openDetail({ iri: property.value, label: property.resolvedLabel, classes: [], properties: [] })"
                >
                  {{ property.resolvedLabel }}
                </button>
                <a v-else-if="property.isResource" :href="property.value" target="_blank" rel="noopener" :title="property.value" @click.stop>
                  {{ localName(property.value) }}
                </a>
                <span v-else>{{ property.value }}</span>
              </dd>
            </template>
          </dl>
          <p v-else class="empty">No properties available.</p>
        </article>
      </div>

      <!-- List layout (pivot) -->
      <div v-else class="list-table-wrapper">
        <table class="list-table">
          <thead>
            <tr>
              <th class="col-label">
                <div class="col-name">Label</div>
                <div class="col-path">@id</div>
              </th>
              <th class="col-label">
                <div class="col-name">Classes</div>
                <div class="col-path">rdf:type</div>
              </th>
              <th
                v-for="col in listColumns"
                :key="col.predicate"
                :title="col.predicate"
              >
                <div class="col-name">{{ col.label }}</div>
                <div class="col-path">{{ col.predicate }}</div>
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
                <div class="cell-name">{{ subject.label }}</div>
                <div class="cell-iri" :title="subject.iri">{{ localName(subject.iri) }}</div>
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
                    class="ref-btn"
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
      :shapes="nodeShapes"
      :shapes-turtle="combinedShapesTurtle"
      :values-turtle="ttlOutput"
    />
  </div>
</template>

<style scoped lang="scss">
.browse-view {
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.browse-view.is-ttl-layout {
  height: calc(100vh - 2rem);
  min-height: calc(100vh - 2rem);
  box-sizing: border-box;
  overflow: hidden;
}
.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.view-header h1 { margin: 0 0 var(--space-1); font-size: 1.75rem; }
.subtitle { margin: 0; color: var(--color-text-muted); }

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
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
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

.class-filter select {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  padding: 0.7rem 0.8rem;
  font: inherit;
}

.layout-label { margin-left: var(--space-1); }

.ttl-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  flex: 1;
  min-height: 0;
  overflow: hidden;
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

.subject-classes,
.class-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
  &.clickable { cursor: pointer; }
  &.clickable:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
}
.card-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  h3 {
    margin: 0;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-iri {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.props {
  display: grid;
  grid-template-columns: minmax(80px, max-content) 1fr;
  gap: var(--space-1) var(--space-2);
  margin: 0;
  font-size: 0.85rem;
  dt {
    color: var(--color-text-muted);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
    a { color: var(--color-primary); text-decoration: none; &:hover { text-decoration: underline; } }
  }
}
.empty { color: var(--color-text-muted); font-style: italic; margin: 0; font-size: 0.85rem; }

.list-table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  th, td {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
  }
  th {
    background: var(--color-bg);
    font-weight: 600;
    position: sticky;
    top: 0;
  }
  tr:last-child td { border-bottom: 0; }
}
.col-name { font-weight: 600; }
.col-path {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-weight: 400;
  margin-top: 2px;
  word-break: break-all;
}
.cell-label .cell-name { font-weight: 500; }
.cell-label .cell-iri {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text-muted);
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

.ref-btn {
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: var(--color-primary);
  font: inherit;
  text-align: left;
  &:hover { text-decoration: underline; }
}

.ttl-details {
  margin-top: var(--space-4);
  summary { cursor: pointer; color: var(--color-text-muted); font-size: 0.85rem; padding: var(--space-2) 0; }
}
.ttl-output {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
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


