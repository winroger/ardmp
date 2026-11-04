<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { buildReviewGraph } from '../reviewGraph'
import { reviewGraphSelection } from '../reviewGraphSelection'
import ReviewGraphCanvas from './ReviewGraphCanvas.vue'

const props = defineProps<{ model: BrowseModel; subjects: readonly BrowseSubject[]; selectedIri?: string | null }>()
const emit = defineEmits<{ openSubject: [iri: string]; deselect: [] }>()
const mode = ref<'type' | 'network'>('type')
const labels = ref(false)
const showConnected = ref(false)
const inspectIri = ref('')
const canvas = ref<InstanceType<typeof ReviewGraphCanvas> | null>(null)
const zoomPercent = ref(100)
const complete = computed(() => buildReviewGraph(props.model, props.model.groups.flatMap(group => group.subjects)))
const matchedIris = computed(() => props.subjects.map(subject => subject.iri))
const selection = computed(() => reviewGraphSelection(complete.value.elements, matchedIris.value, showConnected.value))
const visibleIris = computed(() => selection.value.visibleIris)
const visibleSubjects = computed(() => {
  const ids = new Set(visibleIris.value)
  return complete.value.types.flatMap(type => type.subjects.filter(subject => ids.has(subject.iri)))
})
const visibleTypes = computed(() => {
  const ids = new Set(visibleIris.value)
  return complete.value.types.map(type => ({ ...type, count: type.subjects.filter(subject => ids.has(subject.iri)).length })).filter(type => type.count)
})
const edgeCount = computed(() => {
  const ids = new Set(visibleIris.value.map(iri => `subject:${iri}`))
  return complete.value.elements.filter(element => element.data.source && ids.has(element.data.source) && ids.has(element.data.target)).length
})
function fit(): void { canvas.value?.fit() }
function zoom(factor: number): void { canvas.value?.zoom(factor) }
</script>

<template>
  <section class="review-graph" aria-label="Subject graph">
    <header class="graph-controls">
      <div class="graph-display-options" role="group" aria-label="Graph display options">
        <button type="button" :aria-pressed="mode === 'type'" @click="mode = 'type'">By type</button>
        <button type="button" :aria-pressed="mode === 'network'" @click="mode = 'network'">Network</button>
      </div>
      <label class="graph-label-toggle"><input v-model="labels" type="checkbox"> Labels</label>
      <label class="graph-label-toggle" title="Include directly linked entities in both directions, even if they do not match the filters.">
        <input v-model="showConnected" type="checkbox" aria-label="Show connected entities"> Show connected entities
      </label>
      <select v-model="inspectIri" class="form-select graph-inspect" aria-label="Inspect entity" @change="inspectIri && emit('openSubject', inspectIri)">
        <option value="">Inspect an entity...</option>
        <option v-for="subject in visibleSubjects" :key="subject.iri" :value="subject.iri">{{ subject.label }}</option>
      </select>
    </header>
    <div class="graph-legend" aria-label="Entity type colors">
      <span v-for="type in visibleTypes" :key="type.iri" :title="type.iri">
        <span class="type-dot" :style="{ background: type.color }" />{{ type.label }} <span class="type-count">{{ type.count.toLocaleString() }}</span>
      </span>
    </div>
    <div class="graph-stage">
      <ReviewGraphCanvas
        ref="canvas" class="graph-canvas" :elements="complete.elements" :visible-iris="visibleIris" :matched-iris="matchedIris" :selected-iri="selectedIri" :mode="mode" :labels="labels"
        @open-subject="iri => emit('openSubject', iri)" @zoom-change="value => zoomPercent = value"
        @deselect="inspectIri = ''; emit('deselect')"
      />
      <p v-if="!visibleSubjects.length" class="graph-message" role="status">No entities match the filters.</p>
    </div>
    <footer class="graph-footer">
      <span>
        {{ props.subjects.length.toLocaleString() }} matching entities
        <template v-if="selection.connectedIris.length"> + {{ selection.connectedIris.length.toLocaleString() }} connected (outlined)</template>
        · {{ edgeCount.toLocaleString() }} relationships
      </span>
      <span class="graph-hint">{{ mode === 'type' ? 'Zoom in for more connections · Hover to highlight' : 'Drag to pan · Scroll to zoom · Select to inspect' }}</span>
      <div class="graph-zoom" role="group" aria-label="Graph zoom">
        <button type="button" aria-label="Zoom out" @click="zoom(0.8)">−</button>
        <span class="graph-zoom-value" aria-label="Zoom level">{{ zoomPercent }}%</span>
        <button type="button" aria-label="Fit graph" @click="fit">Fit</button>
        <button type="button" aria-label="Zoom in" @click="zoom(1.25)">+</button>
      </div>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.review-graph { display: flex; flex-direction: column; flex: 1; min-height: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
.graph-controls { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-3); border-bottom: 1px solid var(--color-border); }
.graph-display-options { display: flex; border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow: hidden; }
button { cursor: pointer; font: inherit; color: inherit; background: var(--color-surface); }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.graph-display-options button { padding: var(--space-2) var(--space-3); border: 0; }
.graph-display-options button + button { border-left: 1px solid var(--color-border); }
.graph-display-options button[aria-pressed='true'] { background: var(--color-accent-soft); color: var(--color-primary); }
.graph-label-toggle { display: flex; align-items: center; gap: var(--space-1); font-size: 0.875rem; }
input { accent-color: var(--color-primary); }
.graph-inspect { margin-left: auto; max-width: 240px; min-width: 140px; font-size: 0.875rem; }
.graph-legend { display: flex; gap: var(--space-4); flex-wrap: wrap; padding: var(--space-2) var(--space-3); font-size: 0.75rem; color: var(--color-text-muted); }
.graph-legend > span { display: inline-flex; align-items: center; gap: var(--space-1); }
.type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.type-count { font-variant-numeric: tabular-nums; }
.graph-stage { position: relative; display: flex; flex: 1; min-height: 300px; background: var(--color-surface-2); }
.graph-canvas { flex: 1; min-width: 0; }
.graph-message { position: absolute; top: 45%; left: 10%; right: 10%; text-align: center; pointer-events: none; color: var(--color-text-muted); font-size: 0.875rem; }
.graph-footer { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--color-border); font-size: 0.75rem; color: var(--color-text-muted); }
.graph-zoom { display: flex; gap: var(--space-1); margin-left: auto; }
.graph-zoom-value { align-self: center; min-width: 38px; text-align: center; font-variant-numeric: tabular-nums; }
.graph-zoom button { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); }
@media (max-width: 1150px) { .graph-hint { display: none; } }
</style>
