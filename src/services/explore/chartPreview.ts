import type { EChartsOption } from 'echarts'
import type { ExploreChartDefinitionSnapshot } from '@/services/project/projectSnapshot'
import type { ExploreDataframeModel } from '@/services/explore/exploreService'
import { buildBarChartPreview } from '@/services/explore/barChartPreview'
import { buildGeoChartPreview, type ExploreGeoPreviewModel } from '@/services/explore/geoChartPreview'
import { buildScatterChartPreview } from '@/services/explore/scatterChartPreview'

export type ExploreChartPreviewModel =
  | { kind: 'echarts'; option: EChartsOption }
  | ExploreGeoPreviewModel

export function buildExploreChartPreview(
  chart: ExploreChartDefinitionSnapshot,
  dataframeModel: ExploreDataframeModel,
): ExploreChartPreviewModel | null {
  if (chart.chartType === 'bar') {
    const option = buildBarChartPreview(chart, dataframeModel)
    return option ? { kind: 'echarts', option } : null
  }

  if (chart.chartType === 'scatter') {
    const option = buildScatterChartPreview(chart, dataframeModel)
    return option ? { kind: 'echarts', option } : null
  }

  if (chart.chartType === 'geo') return buildGeoChartPreview(chart, dataframeModel)
  return null
}