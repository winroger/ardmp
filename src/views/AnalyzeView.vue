<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { Store } from 'rdflib'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useDataStore } from '@/stores/dataStore'
import { useExploreStore } from '@/stores/exploreStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useShapesStore } from '@/stores/shapesStore'
import { isCanvasVisibleDataSource } from '@/domain/DataSource'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'
import { buildRuntimeStagingShapes } from '@/services/mapping/stagingShapes'
import {
  buildExploreDataframeModel,
  buildExploreDataset,
  type ExploreClassDefinition,
  type ExploreChartPreviewModel,
  type ExploreDataframeModel,
  type ExploreFieldDefinition,
} from '@/services/explore/exploreService'
import { buildExploreChartPreview } from '@/services/explore/chartPreview'
import { buildBrowseModel, type BrowseModel } from '@/services/browse/browseService'
import { reconcileExploreDataframeDefinitions } from '@/services/explore/dataframeReconciliation'
import ExploreChartPreview from '@/features/explore/components/ExploreChartPreview.vue'
import SubjectDetailDialog from '@/features/browse/components/SubjectDetailDialog.vue'

const shapesStore = useShapesStore()
const dataStore = useDataStore()
const mappingStore = useMappingStore()
const exploreStore = useExploreStore()

const { ap, hasShapes, nodeShapes, profiles } = storeToRefs(shapesStore)
const { sources } = storeToRefs(dataStore)
const { dataframes, charts, dataframeDraft, chartDraft } = storeToRefs(exploreStore)

const runtimeStagingShapes = computed(() =>
  buildRuntimeStagingShapes(sources.value, mappingStore.state, nodeShapes.value),
)

const exploreNodeShapes = computed(() => [
  ...nodeShapes.value,
  ...runtimeStagingShapes.value.nodeShapes,
])

const canExplore = computed(() =>
  sources.value.some(source => isCanvasVisibleDataSource(source))
  || (hasShapes.value && sources.value.length > 0 && mappingStore.state.hasMappings),
)

const datasetError = ref<string | null>(null)
const dataset = ref<ReturnType<typeof buildExploreDataset> | null>(null)
const currentStore = ref<Store | null>(null)
const browseModel = ref<BrowseModel | null>(null)
const ttlOutput = ref('')

const builderDialogOpen = ref(false)
const builderStep = ref<1 | 2>(1)
const dataframeMode = ref<'select' | 'create' | 'edit'>('select')
const selectedFieldIdToAdd = ref('')
const editingChartId = ref<string | null>(null)
const editingDataframeId = ref<string | null>(null)
const activeChartId = ref<string | null>(null)
const detailOpen = ref(false)
const detailSubjectIri = ref<string | null>(null)

const combinedShapesTurtle = computed(() =>
  profiles.value.map(profile => profile.rawTurtle).join('\n\n'),
)

const browseShapesTurtle = computed(() =>
  [combinedShapesTurtle.value, runtimeStagingShapes.value.turtle].filter(Boolean).join('\n\n'),
)

async function regenerate(): Promise<void> {
  if (!canExplore.value) {
    currentStore.value = null
    dataset.value = null
    browseModel.value = null
    ttlOutput.value = ''
    datasetError.value = null
    return
  }

  datasetError.value = null
  try {
    const generated = generateRdf(ap.value, mappingStore.state, sources.value)
    currentStore.value = generated.store as Store
    dataset.value = buildExploreDataset(generated.store as Store, exploreNodeShapes.value, sources.value)
    browseModel.value = buildBrowseModel(generated.store as Store, exploreNodeShapes.value, sources.value)
    ttlOutput.value = await serializeGraph(generated.store as Store, 'text/turtle')

    const reconciledDataframes = reconcileExploreDataframeDefinitions(
      dataframes.value,
      sources.value,
      mappingStore.state,
      nodeShapes.value,
    )
    reconciledDataframes.forEach((dataframe, index) => {
      if (dataframe !== dataframes.value[index]) {
        exploreStore.replaceDataframe(dataframes.value[index].id, dataframe)
      }
    })
  } catch (error) {
    datasetError.value = error instanceof Error ? error.message : String(error)
    currentStore.value = null
    dataset.value = null
    browseModel.value = null
    ttlOutput.value = ''
  }
}

onMounted(regenerate)

watch(
  [
    () => sources.value.length,
    () => sources.value.map(source => source.id).join('|'),
    () => profiles.value.length,
    () => nodeShapes.value.length,
    () => mappingStore.state.edges.length,
    () => JSON.stringify(mappingStore.state.stagingColumns.inactiveColumnsBySource),
  ],
  regenerate,
)

const classOptions = computed(() =>
  (dataset.value?.classes ?? []).map(classDefinition => ({
    label: `${classDefinition.classLabel} (${classDefinition.subjectCount})`,
    value: classDefinition.classIri,
  })),
)

const rootClassDefinition = computed<ExploreClassDefinition | null>(() =>
  dataset.value?.classes.find(classDefinition => classDefinition.classIri === dataframeDraft.value.rootClassIri) ?? null,
)

const availableFieldOptions = computed(() =>
  (rootClassDefinition.value?.fields ?? []).map(field => ({
    label: `${field.label} · ${field.kind}`,
    value: field.id,
  })),
)

function dataframeModelFor(definition: Parameters<typeof buildExploreDataframeModel>[2]): ExploreDataframeModel | null {
  if (!currentStore.value) return null
  return buildExploreDataframeModel(
    currentStore.value as Parameters<typeof buildExploreDataframeModel>[0],
    exploreNodeShapes.value,
    definition,
    sources.value,
  )
}

const dataframeDraftModel = computed<ExploreDataframeModel | null>(() => {
  if (!dataframeDraft.value.rootClassIri || dataframeDraft.value.columns.length === 0) return null
  return dataframeModelFor({
    id: editingDataframeId.value ?? 'draft-dataframe',
    title: dataframeDraft.value.title.trim() || 'Preview dataframe',
    rootClassIri: dataframeDraft.value.rootClassIri,
    columns: dataframeDraft.value.columns,
  })
})

const dataframeValidationMessage = computed(() => {
  if (dataframeMode.value === 'select') {
    if (!chartDraft.value.dataframeId) return 'Choose an existing dataframe or switch to creating a new one.'
    return null
  }

  if (!dataframeDraft.value.rootClassIri) return 'Choose a root class for the dataframe query.'
  if (dataframeDraft.value.columns.length === 0) return 'Add at least one direct or linked field to materialize the dataframe.'
  if (!dataframeDraftModel.value?.rows.length) return 'The current query does not return any rows from the RDF graph.'
  return null
})

const dataframeOptions = computed(() =>
  dataframes.value.map(dataframe => ({
    label: dataframe.title,
    value: dataframe.id,
  })),
)

const selectedChartDataframe = computed(() =>
  dataframes.value.find(dataframe => dataframe.id === chartDraft.value.dataframeId) ?? null,
)

const selectedChartDataframeModel = computed<ExploreDataframeModel | null>(() => {
  if (!selectedChartDataframe.value) return null
  return dataframeModelFor(selectedChartDataframe.value)
})

const chartFieldDefinitions = computed(() => {
  const selectedDataframe = selectedChartDataframe.value
  if (!selectedDataframe) return [] as ExploreFieldDefinition[]
  const classDefinition = dataset.value?.classes.find(entry => entry.classIri === selectedDataframe.rootClassIri)
  if (!classDefinition) return [] as ExploreFieldDefinition[]
  return selectedDataframe.columns
    .map(column => classDefinition.fields.find(field => field.id === column.id))
    .filter((field): field is ExploreFieldDefinition => Boolean(field))
})

const numericChartFields = computed(() =>
  chartFieldDefinitions.value.filter(field => field.kind === 'number'),
)

const categoricalChartFields = computed(() =>
  chartFieldDefinitions.value.filter(field => field.kind !== 'number'),
)

const wktChartFields = computed(() =>
  chartFieldDefinitions.value.filter(field => field.datatype === 'http://www.opengis.net/ont/geosparql#wktLiteral'),
)

const chartFieldsExcludingGeometry = computed(() =>
  chartFieldDefinitions.value.filter(field => field.id !== chartDraft.value.fieldMapping.geometry),
)

const geoCategoricalChartFields = computed(() =>
  chartFieldsExcludingGeometry.value.filter(field => field.kind !== 'number'),
)

function chartFieldOption(field: ExploreFieldDefinition) {
  return {
    label: `${field.label} · ${field.kind}`,
    value: field.id,
  }
}

const defaultOption = { label: 'Default', value: '' }
const noneOption = { label: 'None', value: '' }

const chartValidationMessage = computed(() => {
  if (!chartDraft.value.dataframeId) return 'Choose or create a dataframe before configuring a chart.'
  if (chartDraft.value.chartType === 'bar' && !chartDraft.value.fieldMapping.category) return 'Bar charts need a category field.'
  if (chartDraft.value.chartType === 'scatter' && (!chartDraft.value.fieldMapping.x || !chartDraft.value.fieldMapping.y)) {
    return 'Scatter charts need numeric X and Y fields.'
  }
  if (chartDraft.value.chartType === 'geo' && !chartDraft.value.fieldMapping.geometry) {
    return 'Geo charts need a WKT geometry field.'
  }
  if (!selectedChartDataframeModel.value?.rows.length) return 'The selected dataframe currently has no rows to chart.'
  if (chartDraft.value.chartType === 'geo' && selectedChartDataframeModel.value && !buildExploreChartPreview(draftChartDefinition.value, selectedChartDataframeModel.value)) {
    return 'Geo charts need at least one valid POINT WKT value.'
  }
  return null
})

const draftChartDefinition = computed(() => ({
  id: editingChartId.value ?? 'draft-chart',
  title: chartDraft.value.title.trim() || 'Preview chart',
  chartType: chartDraft.value.chartType,
  dataframeId: chartDraft.value.dataframeId,
  fieldMapping: { ...chartDraft.value.fieldMapping },
}))

const previewChart = computed<ExploreChartPreviewModel | null>(() => {
  if (!selectedChartDataframeModel.value || chartValidationMessage.value) return null
  return buildExploreChartPreview(draftChartDefinition.value, selectedChartDataframeModel.value)
})

const savedCharts = computed(() =>
  charts.value.map(chart => {
    const dataframe = dataframes.value.find(entry => entry.id === chart.dataframeId) ?? null
    const dataframeModel = dataframe ? dataframeModelFor(dataframe) : null
    return {
      chart,
      dataframe,
      dataframeModel,
    }
  }),
)

const activeSavedChart = computed(() => {
  if (savedCharts.value.length === 0) return null
  return savedCharts.value.find(entry => entry.chart.id === activeChartId.value) ?? savedCharts.value[0]
})

function openDetailByIri(subjectIri: string): void {
  detailSubjectIri.value = subjectIri
  detailOpen.value = true
}

watch(savedCharts, nextSavedCharts => {
  if (nextSavedCharts.length === 0) {
    activeChartId.value = null
    return
  }

  if (!activeChartId.value || !nextSavedCharts.some(entry => entry.chart.id === activeChartId.value)) {
    activeChartId.value = nextSavedCharts[0].chart.id
  }
}, { immediate: true })

function resetBuilderState(): void {
  builderStep.value = 1
  dataframeMode.value = dataframes.value.length > 0 ? 'select' : 'create'
  selectedFieldIdToAdd.value = ''
  editingChartId.value = null
  editingDataframeId.value = null
  exploreStore.resetDataframeDraft()
  exploreStore.resetChartDraft()
}

function openCreateDialog(): void {
  resetBuilderState()
  builderDialogOpen.value = true
}

function openEditDialog(chartId: string): void {
  const chart = charts.value.find(entry => entry.id === chartId)
  if (!chart) return

  resetBuilderState()
  editingChartId.value = chart.id
  exploreStore.setChartDraft(chart)
  dataframeMode.value = 'select'
  builderStep.value = 2
  builderDialogOpen.value = true
}

function closeBuilderDialog(): void {
  builderDialogOpen.value = false
  resetBuilderState()
}

function updateDataframeRootClass(rootClassIri: string): void {
  selectedFieldIdToAdd.value = ''
  const matchingSource = sources.value
    .filter(source => isCanvasVisibleDataSource(source))
    .find(source => reconcileExploreDataframeDefinitions([{ id: 'draft', title: '', rootClassIri, columns: [] }], [source], mappingStore.state, nodeShapes.value)[0].rootClassIri === rootClassIri
      || source.name && false)
  exploreStore.updateDataframeDraft({
    rootClassIri,
    sourceId: matchingSource?.id,
    columns: [],
  })
}

function addSelectedFieldToDataframe(): void {
  if (!selectedFieldIdToAdd.value || !rootClassDefinition.value) return
  const selectedField = rootClassDefinition.value.fields.find(field => field.id === selectedFieldIdToAdd.value)
  if (!selectedField) return

  exploreStore.addColumnToDataframeDraft({
    id: selectedField.id,
    label: selectedField.label,
    datatype: selectedField.datatype,
    path: selectedField.path.map(segment => ({ ...segment })),
  })
  selectedFieldIdToAdd.value = ''
}

function editSelectedDataframe(): void {
  const selectedDataframe = selectedChartDataframe.value
  if (!selectedDataframe) return
  editingDataframeId.value = selectedDataframe.id
  dataframeMode.value = 'edit'
  exploreStore.setDataframeDraft(selectedDataframe)
  exploreStore.updateChartDraft({ dataframeId: selectedDataframe.id })
  selectedFieldIdToAdd.value = ''
}

function useExistingDataframe(dataframeId: string): void {
  editingDataframeId.value = null
  exploreStore.updateChartDraft({
    dataframeId,
  })
}

function persistDataframeDraft(): string | null {
  if ((dataframeMode.value !== 'create' && dataframeMode.value !== 'edit') || dataframeValidationMessage.value) return null
  const dataframe = exploreStore.createDataframeFromDraft()
  const persistedDataframe = {
    ...dataframe,
    id: editingDataframeId.value ?? dataframe.id,
  }

  if (editingDataframeId.value) {
    exploreStore.replaceDataframe(editingDataframeId.value, persistedDataframe)
  } else {
    exploreStore.addDataframe(persistedDataframe)
  }

  editingDataframeId.value = persistedDataframe.id
  exploreStore.updateChartDraft({ dataframeId: persistedDataframe.id })
  return persistedDataframe.id
}

function goToChartStep(): void {
  if (dataframeMode.value === 'select') {
    if (!chartDraft.value.dataframeId) return
    builderStep.value = 2
    return
  }

  const dataframeId = persistDataframeDraft()
  if (!dataframeId) return
  builderStep.value = 2
}

function saveChart(): void {
  if (builderStep.value === 1) {
    goToChartStep()
    return
  }

  if (chartValidationMessage.value) return
  const chart = exploreStore.createChartFromDraft()
  const persistedChart = {
    ...chart,
    id: editingChartId.value ?? chart.id,
  }

  if (editingChartId.value) {
    exploreStore.replaceChart(editingChartId.value, persistedChart)
  } else {
    exploreStore.addChart(persistedChart)
  }

  activeChartId.value = persistedChart.id

  closeBuilderDialog()
}

function backToDataframeStep(): void {
  builderStep.value = 1
}

function removeChart(chartId: string): void {
  exploreStore.removeChart(chartId)
}

function removeDataframe(dataframeId: string): void {
  exploreStore.removeDataframe(dataframeId)
  if (chartDraft.value.dataframeId === dataframeId) {
    exploreStore.updateChartDraft({ dataframeId: '', fieldMapping: {} })
  }
}
</script>

<template>
  <div class="explore-view">
    <header class="page-header page-header--wide">
      <div>
        <h1 class="page-title">Analyze</h1>
        <p class="page-subtitle analyze-subtitle">
          Analyze is a saved-chart dashboard. Create or edit diagrams through a two-step dialog: first choose or define the dataframe, then configure the chart.
        </p>
      </div>
      <div class="view-header__actions">
        <Button label="New chart" icon="pi pi-plus" :disabled="!canExplore" @click="openCreateDialog" />
      </div>
    </header>

    <Message v-if="!canExplore" severity="warn" :closable="false">
      Load source data first. Analyze materializes dataframes from the current generated RDF graph and the loaded SHACL shapes.
    </Message>

    <Message v-else-if="datasetError" severity="error" :closable="false">
      {{ datasetError }}
    </Message>

    <section v-else class="surface-card saved-charts">
      <div class="saved-charts__header">
        <div>
          <h2 class="section-title">Saved Charts</h2>
          <p class="helper-text">Only persisted diagrams are shown here. Dataframes are managed inside the chart dialog.</p>
        </div>
      </div>

      <div v-if="savedCharts.length" class="saved-charts__content">
        <div class="saved-chart-tabs" role="tablist" aria-label="Saved analyze charts">
          <button
            v-for="entry in savedCharts"
            :key="entry.chart.id"
            type="button"
            class="saved-chart-tab"
            :class="{ 'is-active': activeSavedChart?.chart.id === entry.chart.id }"
            :aria-selected="activeSavedChart?.chart.id === entry.chart.id"
            @click="activeChartId = entry.chart.id"
          >
            {{ entry.chart.title }}
          </button>
        </div>

        <article v-if="activeSavedChart" class="saved-chart-card">
          <div class="saved-chart-card__header">
            <div>
              <h3 class="panel-title">{{ activeSavedChart.chart.title }}</h3>
            </div>
            <div class="saved-chart-card__actions">
              <Button icon="pi pi-pen-to-square" text @click="openEditDialog(activeSavedChart.chart.id)" />
              <Button icon="pi pi-trash" text severity="danger" @click="removeChart(activeSavedChart.chart.id)" />
            </div>
          </div>

          <div class="saved-chart-card__body">
            <ExploreChartPreview
              v-if="activeSavedChart.dataframeModel"
              :preview="buildExploreChartPreview(activeSavedChart.chart, activeSavedChart.dataframeModel)!"
              height="100%"
              @open-subject="openDetailByIri"
            />
            <p v-else class="empty-state">This chart cannot be rendered with the current RDF graph.</p>
          </div>
        </article>
      </div>
      <p v-else class="empty-state">No charts saved yet.</p>
    </section>

    <Dialog
      :visible="builderDialogOpen"
      modal
      header="Chart workflow"
      :style="{ width: 'min(1320px, 96vw)' }"
      @update:visible="value => { if (!value) closeBuilderDialog() }"
    >
      <div class="stepper">
        <button type="button" class="stepper__step" :class="{ 'is-active': builderStep === 1 }" @click="builderStep = 1">
          <span>1</span>
          <strong>Create or Select Dataframe</strong>
        </button>
        <button type="button" class="stepper__step" :class="{ 'is-active': builderStep === 2, 'is-disabled': !chartDraft.dataframeId }" :disabled="!chartDraft.dataframeId" @click="builderStep = 2">
          <span>2</span>
          <strong>Chart Builder</strong>
        </button>
      </div>

      <div v-if="builderStep === 1" class="dialog-section">
        <div class="builder-panel__header">
          <div>
            <h2 class="section-title">Step 1: Dataframe</h2>
            <p class="helper-text">{{ dataframeMode === 'edit' ? 'Editing the selected dataframe.' : 'Either select a saved dataframe or create a new one for this chart.' }}</p>
          </div>
          <div class="mode-switch">
            <Button label="Use existing" :severity="dataframeMode === 'select' ? 'contrast' : 'secondary'" :outlined="dataframeMode !== 'select'" @click="dataframeMode = 'select'" />
            <Button v-if="dataframeMode !== 'edit'" label="Create new" :severity="dataframeMode === 'create' ? 'contrast' : 'secondary'" :outlined="dataframeMode !== 'create'" @click="dataframeMode = 'create'" />
            <Tag v-else value="Editing existing dataframe" severity="info" />
          </div>
        </div>

        <template v-if="dataframeMode === 'select'">
          <div class="builder-grid">
            <label>
              <span>Saved dataframe</span>
              <Select
                :model-value="chartDraft.dataframeId"
                :options="dataframeOptions"
                option-label="label"
                option-value="value"
                placeholder="Choose a dataframe"
                @update:model-value="value => useExistingDataframe(value)"
              />
            </label>

            <div class="inline-action inline-action--right">
              <span>Edit selected dataframe</span>
              <Button label="Edit dataframe" icon="pi pi-file-edit" :disabled="!selectedChartDataframe" @click="editSelectedDataframe" />
            </div>
          </div>

          <section class="surface-subsection">
            <h3 class="panel-title">Saved dataframe preview</h3>
            <div v-if="selectedChartDataframeModel?.rows.length" class="table-preview">
              <table class="data-table data-table--comfortable">
                <thead>
                  <tr>
                    <th v-for="column in selectedChartDataframeModel.definition.columns" :key="column.id">
                      {{ column.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in selectedChartDataframeModel.rows.slice(0, 8)" :key="row.subjectIri">
                    <td v-for="column in selectedChartDataframeModel.definition.columns" :key="column.id">
                      {{ row.values[column.id] ?? '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="empty-state">Choose a saved dataframe or switch to creating a new one.</p>
          </section>

          <div v-if="selectedChartDataframe" class="danger-zone">
            <Button label="Delete selected dataframe" icon="pi pi-trash" text severity="danger" @click="removeDataframe(selectedChartDataframe.id)" />
          </div>
        </template>

        <template v-else>
          <div class="builder-grid">
            <label>
              <span>Dataframe title</span>
              <InputText
                :model-value="dataframeDraft.title"
                placeholder="Buildings with location metadata"
                @update:model-value="value => exploreStore.updateDataframeDraft({ title: value })"
              />
            </label>

            <label>
              <span>Root class</span>
              <Select
                :model-value="dataframeDraft.rootClassIri"
                :options="classOptions"
                option-label="label"
                option-value="value"
                placeholder="Choose a class"
                @update:model-value="value => updateDataframeRootClass(value)"
              />
            </label>

            <label>
              <span>Available field path</span>
              <Select
                :model-value="selectedFieldIdToAdd"
                :options="availableFieldOptions"
                option-label="label"
                option-value="value"
                placeholder="Choose a direct, linked, or subject field"
                @update:model-value="value => selectedFieldIdToAdd = value"
              />
            </label>

            <div class="inline-action inline-action--right">
              <span>Add query column</span>
              <Button label="Add column" icon="pi pi-plus" :disabled="!selectedFieldIdToAdd" @click="addSelectedFieldToDataframe" />
            </div>
          </div>

          <Message v-if="dataframeValidationMessage" severity="info" :closable="false">
            {{ dataframeValidationMessage }}
          </Message>

          <section class="surface-subsection">
            <h3 class="panel-title">Dataframe Preview</h3>
            <div v-if="dataframeDraftModel?.rows.length" class="table-preview">
              <table class="data-table data-table--comfortable">
                <thead>
                  <tr>
                    <th v-for="column in dataframeDraftModel.definition.columns" :key="column.id">
                      <div class="table-preview__header-cell">
                        <span>{{ column.label }}</span>
                        <button
                          type="button"
                          class="table-preview__remove"
                          aria-label="Remove column"
                          @click="exploreStore.removeColumnFromDataframeDraft(column.id)"
                        >
                          <span class="pi pi-times" aria-hidden="true"></span>
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in dataframeDraftModel.rows.slice(0, 8)" :key="row.subjectIri">
                    <td v-for="column in dataframeDraftModel.definition.columns" :key="column.id">
                      {{ row.values[column.id] ?? '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="empty-state">The current query preview is empty.</p>
          </section>
        </template>
      </div>

      <div v-else class="dialog-section">
        <div class="builder-panel__header">
          <div>
            <h2 class="section-title">Step 2: Chart Builder</h2>
            <p class="helper-text">Configure the saved dataframe as a chart. Geo charts accept WKT POINT values, while scatter plots support explicit defaults for color and dot size.</p>
          </div>
        </div>

        <div class="builder-grid">
          <label>
            <span>Chart title</span>
            <InputText
              :model-value="chartDraft.title"
              placeholder="Height by region"
              @update:model-value="value => exploreStore.updateChartDraft({ title: value })"
            />
          </label>

          <label>
            <span>Dataframe</span>
            <Select
              :model-value="chartDraft.dataframeId"
              :options="dataframeOptions"
              option-label="label"
              option-value="value"
              placeholder="Choose a dataframe"
              @update:model-value="value => useExistingDataframe(value)"
            />
          </label>

          <label>
            <span>Chart type</span>
            <Select
              :model-value="chartDraft.chartType"
              :options="[
                { label: 'Bar', value: 'bar' },
                { label: 'Scatter', value: 'scatter' },
                { label: 'Geo map', value: 'geo' },
              ]"
              option-label="label"
              option-value="value"
              @update:model-value="value => exploreStore.updateChartDraft({ chartType: value, fieldMapping: {} })"
            />
          </label>

          <template v-if="chartDraft.chartType === 'bar'">
            <label>
              <span>Category field</span>
              <Select
                :model-value="chartDraft.fieldMapping.category"
                :options="chartFieldDefinitions.map(chartFieldOption)"
                option-label="label"
                option-value="value"
                placeholder="Choose a column"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { category: value } })"
              />
            </label>

            <label>
              <span>Numeric value field</span>
              <Select
                :model-value="chartDraft.fieldMapping.y"
                :options="[defaultOption, ...numericChartFields.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Default count"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { y: value || undefined } })"
              />
            </label>
          </template>

          <template v-else-if="chartDraft.chartType === 'scatter'">
            <label>
              <span>X field</span>
              <Select
                :model-value="chartDraft.fieldMapping.x"
                :options="numericChartFields.map(chartFieldOption)"
                option-label="label"
                option-value="value"
                placeholder="Numeric column"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { x: value } })"
              />
            </label>

            <label>
              <span>Y field</span>
              <Select
                :model-value="chartDraft.fieldMapping.y"
                :options="numericChartFields.map(chartFieldOption)"
                option-label="label"
                option-value="value"
                placeholder="Numeric column"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { y: value } })"
              />
            </label>

            <label>
              <span>Color by</span>
              <Select
                :model-value="chartDraft.fieldMapping.color"
                :options="[defaultOption, ...categoricalChartFields.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Default color"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { color: value || undefined } })"
              />
            </label>

            <label>
              <span>Dot size</span>
              <Select
                :model-value="chartDraft.fieldMapping.size"
                :options="[defaultOption, ...numericChartFields.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Default size"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { size: value || undefined } })"
              />
            </label>

            <label>
              <span>Point label</span>
              <Select
                :model-value="chartDraft.fieldMapping.label"
                :options="[noneOption, ...chartFieldDefinitions.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Optional"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { label: value || undefined } })"
              />
            </label>

            <label>
              <span>Median line basis</span>
              <Select
                :model-value="chartDraft.fieldMapping.medianLineBasis"
                :options="[
                  { label: 'None', value: '' },
                  { label: 'X axis median', value: 'x' },
                  { label: 'Y axis median', value: 'y' },
                ]"
                option-label="label"
                option-value="value"
                placeholder="Optional"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { medianLineBasis: value || undefined } })"
              />
            </label>
          </template>

          <template v-else>
            <label>
              <span>Geometry field</span>
              <Select
                :model-value="chartDraft.fieldMapping.geometry"
                :options="wktChartFields.map(chartFieldOption)"
                option-label="label"
                option-value="value"
                placeholder="WKT POINT column"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { geometry: value } })"
              />
            </label>

            <label>
              <span>Color by</span>
              <Select
                :model-value="chartDraft.fieldMapping.color"
                :options="[defaultOption, ...geoCategoricalChartFields.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Default color"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { color: value || undefined } })"
              />
            </label>

            <label>
              <span>Dot size</span>
              <Select
                :model-value="chartDraft.fieldMapping.size"
                :options="[defaultOption, ...numericChartFields.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Default size"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { size: value || undefined } })"
              />
            </label>

            <label>
              <span>Point label</span>
              <Select
                :model-value="chartDraft.fieldMapping.label"
                :options="[noneOption, ...chartFieldsExcludingGeometry.map(chartFieldOption)]"
                option-label="label"
                option-value="value"
                placeholder="Optional"
                @update:model-value="value => exploreStore.updateChartDraft({ fieldMapping: { label: value || undefined } })"
              />
            </label>
          </template>
        </div>

        <Message v-if="chartValidationMessage" severity="info" :closable="false">
          {{ chartValidationMessage }}
        </Message>

        <div class="preview-grid">
          <section class="surface-subsection">
            <h3 class="panel-title">Chart Preview</h3>
            <ExploreChartPreview v-if="previewChart" :preview="previewChart" :height="340" @open-subject="openDetailByIri" />
            <p v-else class="empty-state">Select the required fields to render a preview.</p>
          </section>

          <section class="surface-subsection">
            <h3 class="panel-title">Dataframe Rows</h3>
            <div v-if="selectedChartDataframeModel?.rows.length" class="table-preview">
              <table class="data-table data-table--comfortable">
                <thead>
                  <tr>
                    <th v-for="column in selectedChartDataframeModel.definition.columns" :key="column.id">
                      {{ column.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in selectedChartDataframeModel.rows.slice(0, 8)" :key="row.subjectIri">
                    <td v-for="column in selectedChartDataframeModel.definition.columns" :key="column.id">
                      {{ row.values[column.id] ?? '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="empty-state">No dataframe preview rows available.</p>
          </section>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <Button label="Cancel" text @click="closeBuilderDialog" />
          <Button v-if="builderStep === 2" label="Back" text @click="backToDataframeStep" />
          <Button :label="builderStep === 1 ? 'Continue to chart' : (editingChartId ? 'Save changes' : 'Save chart')" @click="saveChart" />
        </div>
      </template>
    </Dialog>

    <SubjectDetailDialog
      v-model="detailOpen"
      :subject-iri="detailSubjectIri"
      :model="browseModel"
      :shapes="exploreNodeShapes"
      :shapes-turtle="browseShapesTurtle"
      :values-turtle="ttlOutput"
    />
  </div>
</template>

<style scoped lang="scss">
.explore-view {
  max-width: 1440px;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  overflow: auto;
  padding: var(--space-6) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.analyze-subtitle {
  max-width: 74ch;
}

.view-header__actions {
  display: flex;
  align-items: center;
}

.saved-charts {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
}

.saved-charts__header,
.saved-chart-card__header,
.builder-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
}

.saved-chart-card__actions,
.mode-switch,
.dialog-footer {
  display: flex;
  gap: var(--space-2);
}

.saved-charts__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
}

.saved-chart-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  background: var(--color-surface-2);
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
}

.saved-chart-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.saved-chart-tab {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  padding: 10px 14px;
  cursor: pointer;
}

.saved-chart-tab.is-active {
  border-color: var(--color-primary);
  background: rgba(37, 99, 235, 0.08);
}

.saved-chart-card__body {
  flex: 1;
  min-height: 520px;
}

.stepper {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.stepper__step {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text);
  cursor: pointer;

  span {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
}

.stepper__step.is-active {
  border-color: var(--color-primary);
  background: rgba(37, 99, 235, 0.08);
}

.stepper__step.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dialog-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.builder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);

  label,
  .inline-action {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  span {
    font-size: 0.95rem;
    font-weight: 500;
  }
}

.inline-action--right {
  justify-content: flex-end;
}

.danger-zone {
  display: flex;
  justify-content: flex-end;
}

.table-preview__header-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);

  span {
    min-width: 0;
  }
}

.table-preview__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  flex: 0 0 auto;
}

.table-preview__remove:hover {
  background: rgba(220, 38, 38, 0.08);
  color: var(--color-danger, #dc2626);
}

.preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: var(--space-4);
}

.table-preview {
  overflow: auto;
}

.empty-state {
  margin: 0;
  color: var(--color-text-muted);
}

@media (max-width: 960px) {
  .explore-view {
    padding: var(--space-4);
  }

  .view-header,
  .saved-charts__header,
  .saved-chart-card__header,
  .builder-panel__header,
  .stepper {
    flex-direction: column;
    align-items: stretch;
  }

  .preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
