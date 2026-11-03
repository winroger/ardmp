<script setup lang="ts">
import { computed, ref } from 'vue'
import Toast from 'primevue/toast'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import DatasetReview from '@/features/browse/components/DatasetReview.vue'
import SubjectDetailDialog from '@/features/browse/components/SubjectDetailDialog.vue'
import ExploreChartPreview from '@/features/explore/components/ExploreChartPreview.vue'
import { buildExploreChartPreview } from '@/services/explore/chartPreview'
import { restoreViewerGraph } from './rdfSnapshot'
import type { CrateViewerPayload } from './types'

const props = defineProps<{ payload: CrateViewerPayload }>()
const tab = ref<'review' | 'analyze'>('review')
const externalImages = ref(false)
const onlineMaps = ref(false)
const detailIri = ref<string | null>(null)
const detailOpen = ref(false)
const graph = restoreViewerGraph(props.payload.graph)
const ap = new ApplicationProfile()
for (const profile of props.payload.profiles) ap.upsert(parseShaclProfile(profile.turtle, profile.iri, 'embedded', profile.iri))
const shapes = ap.allNodeShapes()
const shapesTurtle = props.payload.profiles.map(profile => profile.turtle).join('\n\n')
const savedCharts = computed(() => props.payload.charts.map(chart => {
  const dataframe = props.payload.dataframes.find(frame => frame.definition.id === chart.dataframeId)
  return { chart, dataframe, preview: dataframe ? buildExploreChartPreview(chart, dataframe) : null }
}))

function openSubject(iri: string): void {
  detailIri.value = iri
  detailOpen.value = true
}
</script>

<template>
  <div class="crate-viewer">
    <Toast />
    <nav class="viewer-navigation" aria-label="Dataset views">
      <div class="viewer-tabs" role="tablist" aria-label="Dataset views">
        <button role="tab" :aria-selected="tab === 'review'" aria-controls="viewer-review" @click="tab = 'review'">Review</button>
        <button role="tab" :aria-selected="tab === 'analyze'" aria-controls="viewer-analyze" @click="tab = 'analyze'">Analyze <span v-if="payload.charts.length">({{ payload.charts.length }})</span></button>
      </div>
      <label class="external-image-control"><input v-model="externalImages" type="checkbox"> Load external images</label>
    </nav>
    <p class="snapshot-note">Published dataset snapshot. Search, filters, relationships and saved charts work offline. External images and optional map tiles require internet.</p>

    <div v-show="tab === 'review'" id="viewer-review" role="tabpanel" class="viewer-review">
      <DatasetReview
        :model="payload.model" :generated-store="graph" :browse-node-shapes="shapes" :browse-shapes-turtle="shapesTurtle"
        :ttl-output="payload.turtle" :can-browse="true" :generation-error="null" offline :allow-external-images="externalImages"
      />
    </div>
    <section v-if="tab === 'analyze'" id="viewer-analyze" role="tabpanel" class="viewer-analyze">
      <header class="page-header"><div><h1 class="page-title">Analyze</h1><p class="page-subtitle">Saved charts and dataframes from this dataset.</p></div></header>
      <p v-if="!payload.charts.length" class="analysis-empty">No charts were saved with this export.</p>
      <label v-if="payload.charts.some(chart => chart.chartType === 'geo')" class="online-map-control"><input v-model="onlineMaps" type="checkbox"> Load online basemaps (OpenStreetMap)</label>
      <p v-for="message in payload.analysisErrors" :key="message" class="analysis-error">{{ message }}</p>
      <article v-for="entry in savedCharts" :key="entry.chart.id" class="saved-chart">
        <h2>{{ entry.chart.title }}</h2>
        <p class="chart-caption">{{ entry.dataframe?.definition.title ?? 'Dataframe unavailable' }}</p>
        <ExploreChartPreview
          v-if="entry.preview" :key="`${entry.chart.id}:${onlineMaps}`" :preview="entry.preview" :height="360"
          :allow-online-tiles="onlineMaps" @open-subject="openSubject"
        />
        <p v-else>No chart values are available for this saved configuration.</p>
      </article>
      <details v-for="frame in payload.dataframes" :key="frame.definition.id" class="saved-dataframe">
        <summary>{{ frame.definition.title }} ({{ frame.rows.length }} rows)</summary>
        <div class="dataframe-scroll">
          <table class="data-table"><thead><tr><th>Subject</th><th v-for="column in frame.definition.columns" :key="column.id">{{ column.label }}</th></tr></thead>
            <tbody><tr v-for="(row, index) in frame.rows" :key="`${row.subjectIri}:${index}`"><td><button class="link-button" @click="openSubject(row.subjectIri)">{{ row.subjectLabel }}</button></td><td v-for="column in frame.definition.columns" :key="column.id">{{ row.values[column.id] }}</td></tr></tbody>
          </table>
        </div>
      </details>
      <SubjectDetailDialog
        v-model="detailOpen" :subject-iri="detailIri" :model="payload.model" :shapes="shapes"
        :shapes-turtle="shapesTurtle" :values-turtle="payload.turtle" offline :allow-external-images="externalImages"
      />
    </section>
  </div>
</template>

<style scoped>
.viewer-navigation { display: flex; align-items: center; flex-wrap: wrap; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
.viewer-tabs { display: flex; gap: 0.5rem; }
.viewer-tabs button { border: 1px solid var(--color-border); border-radius: 8px; padding: 0.6rem 1rem; font: inherit; background: white; cursor: pointer; }
.viewer-tabs button[aria-selected="true"] { background: #0f172a; color: white; border-color: #0f172a; }
.external-image-control { margin-left: auto; font-size: 0.85rem; }
.snapshot-note { margin: 0; padding: 0.75rem 1.5rem; color: var(--color-text-muted); font-size: 0.85rem; }
.viewer-review { height: max(600px, calc(100vh - 300px)); }
.viewer-analyze { padding: 1.5rem; max-width: 1440px; margin: auto; display: flex; flex-direction: column; gap: 1.25rem; }
.saved-chart, .saved-dataframe { padding: 1rem; border: 1px solid var(--color-border); border-radius: 10px; background: white; }
.saved-chart h2 { margin: 0 0 0.25rem; font-size: 1.15rem; }
.chart-caption { margin: 0 0 1rem; color: var(--color-text-muted); }
.saved-dataframe summary { cursor: pointer; font-weight: 600; }
.dataframe-scroll { overflow: auto; max-height: 500px; margin-top: 1rem; }
.analysis-error { color: var(--color-danger); }
</style>
