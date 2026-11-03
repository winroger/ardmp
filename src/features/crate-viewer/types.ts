import type { BrowseModel } from '@/services/browse/browseService'
import type { ExploreDataframeModel } from '@/services/explore/exploreService'
import type { ExploreChartDefinitionSnapshot } from '@/services/project/projectSnapshot'
import type { RdfSnapshot } from './rdfSnapshot'

export interface CrateViewerPayload {
  version: 1
  title: string
  turtle: string
  graph: RdfSnapshot
  model: BrowseModel
  profiles: { iri: string; turtle: string }[]
  dataframes: ExploreDataframeModel[]
  charts: ExploreChartDefinitionSnapshot[]
  analysisErrors: string[]
}
