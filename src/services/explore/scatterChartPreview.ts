import type { EChartsOption } from 'echarts'
import type { ExploreChartDefinitionSnapshot } from '@/services/project/projectSnapshot'
import type { ExploreDataframeModel } from '@/services/explore/exploreService'
import { fieldLabel, numericValue, stringValue } from '@/services/explore/chartPreviewShared'

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function buildScatterChartPreview(
  chart: ExploreChartDefinitionSnapshot,
  dataframeModel: ExploreDataframeModel,
): EChartsOption | null {
  const xKey = chart.fieldMapping.x
  const yKey = chart.fieldMapping.y
  if (!xKey || !yKey) return null

  const colorKey = chart.fieldMapping.color
  const sizeKey = chart.fieldMapping.size
  const medianLineBasis = chart.fieldMapping.medianLineBasis
  const palette = ['#0f766e', '#2563eb', '#ea580c', '#7c3aed', '#dc2626', '#0891b2']
  const colors = new Map<string, string>()

  const sizeValues = dataframeModel.rows
    .map(row => numericValue(sizeKey ? row.values[sizeKey] : null))
    .filter((value): value is number => value !== null)
  const minSizeValue = sizeValues.length > 0 ? Math.min(...sizeValues) : null
  const maxSizeValue = sizeValues.length > 0 ? Math.max(...sizeValues) : null

  function symbolSize(row: { values: Record<string, string | number | null> }): number {
    const sizeValue = numericValue(sizeKey ? row.values[sizeKey] : null)
    if (sizeValue === null || minSizeValue === null || maxSizeValue === null || minSizeValue === maxSizeValue) return 14
    const ratio = (sizeValue - minSizeValue) / (maxSizeValue - minSizeValue)
    return 10 + (ratio * 18)
  }

  interface ScatterPoint {
    value: [number, number]
    name: string
    itemStyle?: { color?: string }
    symbolSize: number
  }

  const points: ScatterPoint[] = []
  for (const row of dataframeModel.rows) {
    const x = numericValue(row.values[xKey])
    const y = numericValue(row.values[yKey])
    if (x === null || y === null) continue

    const colorValue = colorKey ? stringValue(row.values[colorKey], 'Unassigned') : null
    if (colorValue && !colors.has(colorValue)) {
      colors.set(colorValue, palette[colors.size % palette.length])
    }

    points.push({
      value: [x, y],
      name: stringValue(chart.fieldMapping.label ? row.values[chart.fieldMapping.label] : row.subjectLabel, row.subjectLabel),
      itemStyle: colorValue ? { color: colors.get(colorValue) } : undefined,
      symbolSize: symbolSize(row),
    })
  }

  if (points.length === 0) return null

  const medianValue = medianLineBasis === 'x'
    ? median(points.map(point => point.value[0]))
    : medianLineBasis === 'y'
      ? median(points.map(point => point.value[1]))
      : null

  return {
    animationDuration: 300,
    tooltip: {
      trigger: 'item',
      formatter: params => {
        const point = params as { data?: { name?: string; value?: [number, number] } }
        const name = point.data?.name ?? ''
        const value = point.data?.value ?? [0, 0]
        return `${name}<br>${fieldLabel(dataframeModel.definition.columns, xKey, 'X')}: ${value[0]}<br>${fieldLabel(dataframeModel.definition.columns, yKey, 'Y')}: ${value[1]}`
      },
    },
    legend: colorKey ? {
      data: Array.from(colors.keys()),
      top: 24,
      right: 24,
    } : undefined,
    grid: { top: 56, right: 24, bottom: 48, left: 56 },
    xAxis: {
      type: 'value',
      name: fieldLabel(dataframeModel.definition.columns, xKey, 'X'),
    },
    yAxis: {
      type: 'value',
      name: fieldLabel(dataframeModel.definition.columns, yKey, 'Y'),
    },
    series: [{
      type: 'scatter',
      data: points,
      symbolSize: value => {
        const point = value as { symbolSize?: number }
        return point.symbolSize ?? 14
      },
      itemStyle: colorKey ? undefined : { color: '#0f766e' },
      markLine: medianValue === null
        ? undefined
        : {
          symbol: ['none', 'none'],
          lineStyle: { type: 'dashed', color: '#dc2626' },
          data: [medianLineBasis === 'x'
            ? { xAxis: medianValue, name: `Median ${fieldLabel(dataframeModel.definition.columns, xKey, 'X')}` }
            : { yAxis: medianValue, name: `Median ${fieldLabel(dataframeModel.definition.columns, yKey, 'Y')}` }],
        },
    }],
  }
}