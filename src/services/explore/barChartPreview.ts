import type { EChartsOption } from 'echarts'
import type { ExploreChartDefinitionSnapshot } from '@/services/project/projectSnapshot'
import type { ExploreDataframeColumnSnapshot } from '@/services/project/projectSnapshot'
import type { ExploreDataframeModel } from '@/services/explore/exploreService'
import { fieldDatatype, fieldLabel, numericValue, NUMERIC_DATATYPE_IRIS, stringValue, XSD_YEAR_IRI } from '@/services/explore/chartPreviewShared'

function sortBarEntries(
  entries: [string, number][],
  fields: readonly ExploreDataframeColumnSnapshot[],
  categoryKey: string,
): [string, number][] {
  const datatype = fieldDatatype(fields, categoryKey)
  const shouldSortByCategory = datatype === XSD_YEAR_IRI
    || NUMERIC_DATATYPE_IRIS.has(datatype ?? '')
    || entries.every(([label]) => numericValue(label) !== null)

  if (!shouldSortByCategory) return entries.sort((left, right) => right[1] - left[1])

  return entries.sort((left, right) => {
    const leftValue = numericValue(left[0])
    const rightValue = numericValue(right[0])
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return leftValue - rightValue
    }
    return left[0].localeCompare(right[0], undefined, { numeric: true })
  })
}

export function buildBarChartPreview(
  chart: ExploreChartDefinitionSnapshot,
  dataframeModel: ExploreDataframeModel,
): EChartsOption | null {
  const categoryKey = chart.fieldMapping.category
  if (!categoryKey) return null

  const grouped = new Map<string, number>()
  for (const row of dataframeModel.rows) {
    const category = stringValue(row.values[categoryKey], row.subjectLabel)
    const yCandidate = numericValue(chart.fieldMapping.y ? row.values[chart.fieldMapping.y] : null)
    const nextValue = yCandidate ?? 1
    grouped.set(category, (grouped.get(category) ?? 0) + nextValue)
  }

  const entries = sortBarEntries(Array.from(grouped.entries()), dataframeModel.definition.columns, categoryKey)
  if (entries.length === 0) return null

  return {
    animationDuration: 300,
    tooltip: { trigger: 'axis' },
    grid: { top: 56, right: 24, bottom: 48, left: 56 },
    xAxis: {
      type: 'category',
      data: entries.map(([label]) => label),
      axisLabel: { interval: 0, rotate: entries.length > 6 ? 25 : 0 },
      name: fieldLabel(dataframeModel.definition.columns, categoryKey, 'Category'),
    },
    yAxis: {
      type: 'value',
      name: chart.fieldMapping.y
        ? fieldLabel(dataframeModel.definition.columns, chart.fieldMapping.y, 'Value')
        : 'Count',
    },
    series: [{
      type: 'bar',
      data: entries.map(([, value]) => value),
      itemStyle: { color: '#2563eb' },
    }],
  }
}