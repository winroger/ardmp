<script setup lang="ts">
/**
 * SubjectDetailDialog
 *
 * Opens a modal that renders one RDF subject through the `<shacl-form>`
 * web component in viewer mode and offers a relationship graph for
 * navigating to connected generated subjects.
 *
 * Inputs:
 *  - `modelValue`  controls dialog visibility (v-model)
 *  - `subjectIri`  IRI of the subject to display
 *  - `model`       the current `BrowseModel` (used to resolve labels and
 *                  find the matching NodeShape per class)
 *  - `shapesTurtle`  combined SHACL turtle (data shapes only - same as
 *                    used to drive the canvas)
 *  - `valuesTurtle`  full generated data graph as turtle (drives the
 *                    pre-populated form)
 *
 * The dialog keeps the selected subject in a one-item stack so switching
 * between related instances replaces the current selection without
 * growing a breadcrumb trail.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import '@ulb-darmstadt/shacl-form'
import { LeafletPlugin } from '@ulb-darmstadt/shacl-form/plugins/leaflet.js'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import type { NodeShape } from '@/domain/NodeShape'
import { useShaclFormViewer, type ShaclFormElement } from '@/features/shacl/useShaclFormViewer'

const formsWithLeafletViewer = new WeakSet<HTMLElement>()

interface Props {
  modelValue: boolean
  subjectIri: string | null
  model: BrowseModel | null
  shapes: readonly NodeShape[]
  shapesTurtle: string
  valuesTurtle: string
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

/** Navigation history - newest entry at the end. */
const stack = ref<string[]>([])

watch(
  () => [props.modelValue, props.subjectIri] as const,
  ([open, iri]) => {
    if (open && iri) {
      // Reset the stack to the freshly opened subject when the dialog opens.
      stack.value = [iri]
    } else if (!open) {
      stack.value = []
    }
  },
  { immediate: true },
)

const currentIri = computed(() => stack.value[stack.value.length - 1] ?? null)
const activeTab = ref<'factsheet' | 'relationships'>('factsheet')
const graphRef = ref<HTMLElement | null>(null)
const graphInstance = ref<Core | null>(null)

const allSubjects = computed<BrowseSubject[]>(() => {
  if (!props.model) return []
  const subjects: BrowseSubject[] = []
  const seen = new Set<string>()
  for (const group of props.model.groups) {
    for (const subject of group.subjects) {
      if (seen.has(subject.iri)) continue
      seen.add(subject.iri)
      subjects.push(subject)
    }
  }
  return subjects
})

const subjectsByIri = computed(() => {
  const lookup = new Map<string, BrowseSubject>()
  for (const subject of allSubjects.value) lookup.set(subject.iri, subject)
  return lookup
})

/**
 * Resolves the subject (across all groups). A subject may appear in
 * multiple class groups - we return the first occurrence; properties
 * are identical regardless of bucket.
 */
const currentSubject = computed<BrowseSubject | null>(() => {
  const iri = currentIri.value
  return iri ? subjectsByIri.value.get(iri) ?? null : null
})

/** Resolves the NodeShape whose targetClass matches one of the subject's classes. */
const matchingShape = computed<NodeShape | null>(() => {
  const subj = currentSubject.value
  if (!subj) return null
  for (const cls of subj.classes) {
    const shape = props.shapes.find(s => s.targetClass?.value === cls)
    if (shape) return shape
  }
  return null
})

interface RelationshipEntry {
  direction: 'outgoing' | 'incoming'
  predicate: string
  label: string
  subject: BrowseSubject
}

const outgoingRelationships = computed<RelationshipEntry[]>(() => {
  const subj = currentSubject.value
  if (!subj) return []

  const entries: RelationshipEntry[] = []
  for (const property of subj.properties) {
    if (!property.isResource) continue
    const related = subjectsByIri.value.get(property.value)
    if (!related) continue
    entries.push({
      direction: 'outgoing',
      predicate: property.predicate,
      label: property.label || 'Related to',
      subject: related,
    })
  }

  return entries.sort(compareRelationships)
})

const incomingRelationships = computed<RelationshipEntry[]>(() => {
  const subj = currentSubject.value
  if (!subj) return []

  const entries: RelationshipEntry[] = []
  for (const candidate of allSubjects.value) {
    if (candidate.iri === subj.iri) continue
    for (const property of candidate.properties) {
      if (!property.isResource || property.value !== subj.iri) continue
      entries.push({
        direction: 'incoming',
        predicate: property.predicate,
        label: property.label || 'Related to',
        subject: candidate,
      })
    }
  }

  return entries.sort(compareRelationships)
})

const relationships = computed(() => [
  ...incomingRelationships.value,
  ...outgoingRelationships.value,
])

const hasRelationships = computed(() => relationships.value.length > 0)

function compareRelationships(left: RelationshipEntry, right: RelationshipEntry): number {
  return left.label.localeCompare(right.label) || left.subject.label.localeCompare(right.subject.label)
}

function classSummary(subject: BrowseSubject): string {
  return subject.classes.map(localName).join(', ') || 'Untyped'
}

function graphNodeId(iri: string): string {
  return `subject:${iri}`
}

const graphElements = computed<ElementDefinition[]>(() => {
  const subject = currentSubject.value
  if (!subject) return []

  const nodes = new Map<string, ElementDefinition>()
  const edges: ElementDefinition[] = []
  nodes.set(subject.iri, {
    data: {
      id: graphNodeId(subject.iri),
      iri: subject.iri,
      label: subject.label,
      classes: classSummary(subject),
      selected: true,
    },
    classes: 'selected-subject',
  })

  for (const entry of relationships.value) {
    const related = entry.subject
    nodes.set(related.iri, {
      data: {
        id: graphNodeId(related.iri),
        iri: related.iri,
        label: related.label,
        classes: classSummary(related),
        selected: false,
      },
      classes: entry.direction === 'incoming' ? 'incoming-subject' : 'outgoing-subject',
    })
    edges.push({
      data: {
        id: `${entry.direction}:${entry.predicate}:${related.iri}`,
        source: graphNodeId(entry.direction === 'incoming' ? related.iri : subject.iri),
        target: graphNodeId(entry.direction === 'incoming' ? subject.iri : related.iri),
        label: entry.label,
      },
      classes: entry.direction,
    })
  }

  return [...nodes.values(), ...edges]
})

function renderRelationshipGraph(): void {
  if (!graphRef.value || !currentSubject.value || activeTab.value !== 'relationships') return
  const elements = graphElements.value

  destroyRelationshipGraph()
  const cy = cytoscape({
    container: graphRef.value,
    elements,
    minZoom: 0.45,
    maxZoom: 2.5,
    wheelSensitivity: 0.25,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#ffffff',
          'border-color': '#cbd5e1',
          'border-width': 1,
          color: '#0f172a',
          content: 'data(label)',
          'font-size': 12,
          'font-weight': 600,
          height: 54,
          label: 'data(label)',
          shape: 'round-rectangle',
          'text-halign': 'center',
          'text-max-width': '132px',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          width: 154,
        },
      },
      {
        selector: 'node.selected-subject',
        style: {
          'background-color': '#ffffff',
          'border-color': '#2563eb',
          'border-width': 3,
          height: 68,
          width: 178,
        },
      },
      {
        selector: 'node.incoming-subject',
        style: {
          'border-color': '#94a3b8',
        },
      },
      {
        selector: 'node.outgoing-subject',
        style: {
          'border-color': '#60a5fa',
        },
      },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'font-size': 10,
          'line-color': '#cbd5e1',
          'target-arrow-color': '#cbd5e1',
          'target-arrow-shape': 'triangle',
          color: '#64748b',
          content: 'data(label)',
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.95,
          'text-background-padding': '3px',
          'text-max-width': '104px',
          'text-rotation': 'autorotate',
          'text-wrap': 'wrap',
          width: 2,
        },
      },
    ],
  })

  cy.on('tap', 'node', event => {
    const iri = event.target.data('iri') as string | undefined
    if (iri && iri !== currentIri.value) openSubject(iri)
  })
  graphInstance.value = cy

  graphInstance.value.layout({
    name: 'cose',
    animate: false,
    fit: true,
    padding: 40,
    nodeRepulsion: 12000,
    idealEdgeLength: 150,
  }).run()
  graphInstance.value.fit(undefined, 36)
}

function destroyRelationshipGraph(): void {
  graphInstance.value?.destroy()
  graphInstance.value = null
}

function scheduleGraphRender(): void {
  if (!visible.value || activeTab.value !== 'relationships' || !hasRelationships.value) return
  nextTick(() => requestAnimationFrame(renderRelationshipGraph))
}

watch(
  () => [props.modelValue, props.subjectIri] as const,
  ([open, iri]) => {
    if (open && iri) activeTab.value = 'factsheet'
  },
  { immediate: true },
)

watch(hasRelationships, related => {
  if (!related && activeTab.value === 'relationships') activeTab.value = 'factsheet'
})

watch([visible, activeTab, currentIri, graphElements], scheduleGraphRender, { deep: true })

watch([visible, activeTab], ([isVisible, tab]) => {
  if (!isVisible || tab !== 'relationships') destroyRelationshipGraph()
})

onBeforeUnmount(() => {
  destroyRelationshipGraph()
})

function openSubject(iri: string): void {
  if (iri === currentIri.value) return
  stack.value = [iri]
}

function goBack(): void {
  if (stack.value.length > 1) {
    stack.value = stack.value.slice(0, -1)
  }
}

function jumpTo(idx: number): void {
  stack.value = stack.value.slice(0, idx + 1)
}

function labelFor(iri: string): string {
  if (!props.model) return iri
  for (const g of props.model.groups) {
    const s = g.subjects.find(x => x.iri === iri)
    if (s) return s.label
  }
  return iri
}

// ---------- shacl-form wiring ----------
const formRef = ref<ShaclFormElement | null>(null)

useShaclFormViewer({
  formRef,
  watchSources: [
    visible,
    currentIri,
    activeTab,
    () => props.shapesTurtle,
    () => props.valuesTurtle,
    matchingShape,
  ],
  getShapesTurtle: () => props.shapesTurtle,
  getValuesTurtle: () => props.valuesTurtle,
  getValuesSubject: () => currentSubject.value?.iri,
  getShapeSubject: () => matchingShape.value?.nodeId.termType === 'NamedNode'
    ? matchingShape.value.nodeId.value
    : undefined,
  shouldApply: () => visible.value && activeTab.value === 'factsheet',
  prepareElement: element => {
    if (!formsWithLeafletViewer.has(element)) {
      element.registerPlugin?.(new LeafletPlugin({ datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral' }))
      formsWithLeafletViewer.add(element)
    }
  },
})

function localName(iri: string): string {
  const idx = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'))
  return idx >= 0 ? iri.slice(idx + 1) : iri
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :style="{ width: '1080px', maxWidth: '95vw' }"
    :header="currentSubject?.label ?? 'Subject'"
    :pt="{ content: { class: 'subject-dialog-content' } }"
  >
    <div v-if="currentSubject" class="subject-detail">
      <div class="detail-toolbar">
        <Button
          v-if="stack.length > 1"
          icon="pi pi-arrow-left"
          size="small"
          severity="secondary"
          outlined
          @click="goBack"
          aria-label="Back"
        />
        <nav v-if="stack.length > 1" class="breadcrumb" aria-label="Navigation history">
          <template v-for="(iri, idx) in stack" :key="iri + idx">
            <button
              class="crumb"
              :class="{ active: idx === stack.length - 1 }"
              :disabled="idx === stack.length - 1"
              @click="jumpTo(idx)"
            >
              {{ labelFor(iri) }}
            </button>
            <span v-if="idx < stack.length - 1" class="crumb-sep">></span>
          </template>
        </nav>
        <span class="iri" :title="currentSubject.iri">{{ localName(currentSubject.iri) }}</span>
        <span class="classes">
          <Tag
            v-for="cls in currentSubject.classes"
            :key="cls"
            :value="localName(cls)"
            severity="info"
            :title="cls"
          />
        </span>
      </div>

      <div class="detail-tabs" role="tablist" aria-label="Subject detail views">
        <button
          class="detail-tab"
          :class="{ active: activeTab === 'factsheet' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'factsheet'"
          @click="activeTab = 'factsheet'"
        >
          <i class="pi pi-file" />
          <span>Factsheet</span>
        </button>
        <button
          class="detail-tab"
          :class="{ active: activeTab === 'relationships' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'relationships'"
          :disabled="!hasRelationships"
          @click="activeTab = 'relationships'"
        >
          <i class="pi pi-share-alt" />
          <span>Relationships</span>
        </button>
      </div>

      <div v-if="activeTab === 'factsheet'" class="form-pane" role="tabpanel">
          <shacl-form
            ref="formRef"
            :key="currentIri ?? 'subject'"
            data-view
            data-collapse="open"
            data-ignore-owl-imports
            data-language="en"
            data-show-root-shape-label="false"
          />
      </div>

      <section v-if="activeTab === 'relationships'" class="relationship-pane" role="tabpanel">
        <div v-if="hasRelationships" class="relationship-graph-shell">
          <div ref="graphRef" class="cy-graph" aria-label="Subject relationship graph" />
          <div class="graph-legend" aria-hidden="true">
            <span><i class="legend-dot selected" />Selected</span>
            <span><i class="legend-dot incoming" />Incoming</span>
            <span><i class="legend-dot outgoing" />Outgoing</span>
          </div>
        </div>
        <p v-else class="empty">No relationships to other generated subjects.</p>
      </section>
    </div>
    <p v-else class="empty">No subject selected.</p>
  </Dialog>
</template>

<style scoped lang="scss">
.subject-detail { display: flex; flex-direction: column; gap: var(--space-3); }

.detail-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}
.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.85rem;
}
.crumb {
  background: transparent;
  border: 0;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-primary);
  font-size: 0.85rem;
  &:hover:not(:disabled) { background: var(--color-surface-2); }
  &.active { color: var(--color-text); cursor: default; }
}
.crumb-sep { color: var(--color-text-muted); }
.iri {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-left: auto;
}
.classes { display: flex; gap: 4px; flex-wrap: wrap; }

.detail-tabs {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.detail-tab {
  min-height: 2.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.75rem;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1;

  &:hover:not(:disabled) { color: var(--color-text); background: var(--color-surface-1); }
  &.active { color: var(--color-text); background: var(--color-surface); box-shadow: var(--shadow-sm); }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  i { font-size: 0.85rem; }
}

.form-pane {
  min-height: 200px;
  max-height: 65vh;
  overflow: auto;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.relationship-pane {
  min-height: 280px;
  max-height: 65vh;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  background: var(--color-surface);
}

.relationship-graph-shell {
  min-height: 440px;
  height: min(58vh, 620px);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: relative;
}

.cy-graph {
  width: 100%;
  flex: 1;
  min-height: 0;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.graph-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: 0.8rem;

  span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
}

.legend-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 3px;
  border: 1px solid var(--color-border);
  display: flex;

  &.selected { background: #fff; border-color: var(--color-primary); border-width: 2px; }
  &.incoming { background: #fff; border-color: #94a3b8; }
  &.outgoing { background: #fff; border-color: #60a5fa; }
}

@media (max-width: 900px) {
  .relationship-graph-shell { height: 460px; }
}

.empty { color: var(--color-text-muted); font-style: italic; padding: var(--space-4); }
</style>
