import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  cloneExploreChartDefinition,
  cloneExploreDataframeColumn,
  cloneExploreDataframeDefinition,
  cloneExploreSnapshot,
  type ExploreChartDefinitionSnapshot,
  type ExploreChartFieldMappingSnapshot,
  type ExploreChartType,
  type ExploreDataframeColumnSnapshot,
  type ExploreDataframeDefinitionSnapshot,
  type ExploreSnapshot,
} from '@/services/project/projectSnapshot'

export interface ExploreDataframeDraft {
  title: string
  rootClassIri: string
  sourceId?: string
  columns: ExploreDataframeColumnSnapshot[]
}

export interface ExploreChartDraft {
  title: string
  chartType: ExploreChartType
  dataframeId: string
  fieldMapping: ExploreChartFieldMappingSnapshot
}

function createDefaultDataframeDraft(): ExploreDataframeDraft {
  return {
    title: '',
    rootClassIri: '',
    columns: [],
  }
}

function createDefaultChartDraft(): ExploreChartDraft {
  return {
    title: '',
    chartType: 'bar',
    dataframeId: '',
    fieldMapping: {},
  }
}

export const useExploreStore = defineStore('explore', () => {
  const dataframes = ref<ExploreDataframeDefinitionSnapshot[]>([])
  const charts = ref<ExploreChartDefinitionSnapshot[]>([])
  const dataframeDraft = ref<ExploreDataframeDraft>(createDefaultDataframeDraft())
  const chartDraft = ref<ExploreChartDraft>(createDefaultChartDraft())

  const hasCharts = computed(() => charts.value.length > 0)
  const hasDataframes = computed(() => dataframes.value.length > 0)

  function resetDataframeDraft(): void {
    dataframeDraft.value = createDefaultDataframeDraft()
  }

  function resetChartDraft(): void {
    chartDraft.value = createDefaultChartDraft()
  }

  function updateDataframeDraft(patch: Partial<ExploreDataframeDraft>): void {
    dataframeDraft.value = {
      ...dataframeDraft.value,
      ...patch,
      columns: patch.columns ? patch.columns.map(cloneExploreDataframeColumn) : dataframeDraft.value.columns,
    }
  }

  function updateChartDraft(patch: Partial<ExploreChartDraft>): void {
    chartDraft.value = {
      ...chartDraft.value,
      ...patch,
      fieldMapping: {
        ...chartDraft.value.fieldMapping,
        ...(patch.fieldMapping ?? {}),
      },
    }
  }

  function addColumnToDataframeDraft(column: ExploreDataframeColumnSnapshot): void {
    if (dataframeDraft.value.columns.some(entry => entry.id === column.id)) return
    dataframeDraft.value = {
      ...dataframeDraft.value,
      columns: [...dataframeDraft.value.columns, cloneExploreDataframeColumn(column)],
    }
  }

  function removeColumnFromDataframeDraft(columnId: string): void {
    dataframeDraft.value = {
      ...dataframeDraft.value,
      columns: dataframeDraft.value.columns.filter(column => column.id !== columnId),
    }
  }

  function updateDataframeDraftColumnLabel(columnId: string, label: string): void {
    dataframeDraft.value = {
      ...dataframeDraft.value,
      columns: dataframeDraft.value.columns.map(column => (
        column.id === columnId
          ? { ...column, label }
          : column
      )),
    }
  }

  function setDataframeDraft(dataframe: ExploreDataframeDefinitionSnapshot): void {
    dataframeDraft.value = {
      title: dataframe.title,
      rootClassIri: dataframe.rootClassIri,
      sourceId: dataframe.sourceId,
      columns: dataframe.columns.map(cloneExploreDataframeColumn),
    }
  }

  function addDataframe(dataframe: ExploreDataframeDefinitionSnapshot): void {
    dataframes.value = [...dataframes.value, cloneExploreDataframeDefinition(dataframe)]
  }

  function replaceDataframe(dataframeId: string, dataframe: ExploreDataframeDefinitionSnapshot): void {
    dataframes.value = dataframes.value.map(entry => (
      entry.id === dataframeId ? cloneExploreDataframeDefinition(dataframe) : entry
    ))
  }

  function createDataframeFromDraft(): ExploreDataframeDefinitionSnapshot {
    const title = dataframeDraft.value.title.trim()
    return {
      id: crypto.randomUUID(),
      title: title || 'Untitled dataframe',
      rootClassIri: dataframeDraft.value.rootClassIri,
      sourceId: dataframeDraft.value.sourceId,
      columns: dataframeDraft.value.columns.map(cloneExploreDataframeColumn),
    }
  }

  function removeDataframe(dataframeId: string): void {
    dataframes.value = dataframes.value.filter(dataframe => dataframe.id !== dataframeId)
    charts.value = charts.value.filter(chart => chart.dataframeId !== dataframeId)
    if (chartDraft.value.dataframeId === dataframeId) resetChartDraft()
  }

  function addChart(chart: ExploreChartDefinitionSnapshot): void {
    charts.value = [...charts.value, cloneExploreChartDefinition(chart)]
  }

  function replaceChart(chartId: string, chart: ExploreChartDefinitionSnapshot): void {
    charts.value = charts.value.map(entry => (
      entry.id === chartId ? cloneExploreChartDefinition(chart) : entry
    ))
  }

  function setChartDraft(chart: ExploreChartDefinitionSnapshot): void {
    chartDraft.value = {
      title: chart.title,
      chartType: chart.chartType,
      dataframeId: chart.dataframeId,
      fieldMapping: { ...chart.fieldMapping },
    }
  }

  function createChartFromDraft(): ExploreChartDefinitionSnapshot {
    const title = chartDraft.value.title.trim()
    return {
      id: crypto.randomUUID(),
      title: title || 'Untitled chart',
      chartType: chartDraft.value.chartType,
      dataframeId: chartDraft.value.dataframeId,
      fieldMapping: { ...chartDraft.value.fieldMapping },
    }
  }

  function removeChart(chartId: string): void {
    charts.value = charts.value.filter(chart => chart.id !== chartId)
  }

  function createSnapshot(): ExploreSnapshot {
    return cloneExploreSnapshot({
      dataframes: dataframes.value,
      charts: charts.value,
    })
  }

  function restoreSnapshot(snapshot: ExploreSnapshot | undefined): void {
    const next = cloneExploreSnapshot(snapshot)
    dataframes.value = next.dataframes
    charts.value = next.charts
    resetDataframeDraft()
    resetChartDraft()
  }

  function reset(): void {
    dataframes.value = []
    charts.value = []
    resetDataframeDraft()
    resetChartDraft()
  }

  return {
    dataframes,
    charts,
    dataframeDraft,
    chartDraft,
    hasCharts,
    hasDataframes,
    resetDataframeDraft,
    resetChartDraft,
    updateDataframeDraft,
    updateChartDraft,
    addColumnToDataframeDraft,
    removeColumnFromDataframeDraft,
    updateDataframeDraftColumnLabel,
    setDataframeDraft,
    addDataframe,
    replaceDataframe,
    createDataframeFromDraft,
    removeDataframe,
    addChart,
    replaceChart,
    createChartFromDraft,
    setChartDraft,
    removeChart,
    createSnapshot,
    restoreSnapshot,
    reset,
  }
})