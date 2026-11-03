import { graph, parse } from 'rdflib'
import type { ExportInput } from './exportService'
import type { ShaclProfile } from '@/domain/NodeShape'
import { buildBrowseModel } from '@/services/browse/browseService'
import { buildExploreDataframeModel } from '@/services/explore/exploreService'
import { reconcileExploreDataframeDefinitions } from '@/services/explore/dataframeReconciliation'
import { cloneExploreSnapshot } from '@/services/project/projectSnapshot'
import { normalizeViewerGraph, snapshotViewerGraph } from '@/features/crate-viewer/rdfSnapshot'
import type { CrateViewerPayload } from '@/features/crate-viewer/types'

export function buildCrateViewerPayload(input: ExportInput, turtle: string, profiles: ShaclProfile[], title: string): CrateViewerPayload {
  const parsed = graph()
  parse(turtle, parsed, 'http://example.org/', 'text/turtle')
  const store = normalizeViewerGraph(parsed)
  const shapes = [...input.ap.allNodeShapes(), ...profiles.filter(profile => !input.ap.profiles.has(profile.iri)).flatMap(profile => profile.nodeShapes)]
  const explore = cloneExploreSnapshot(input.explore)
  const dataframes: CrateViewerPayload['dataframes'] = []
  const analysisErrors: string[] = []
  for (const definition of reconcileExploreDataframeDefinitions(explore.dataframes, input.sources, input.mapping, shapes)) {
    try {
      const frame = buildExploreDataframeModel(store, shapes, definition, input.sources)
      if (frame) dataframes.push(frame)
      else analysisErrors.push(`${definition.title}: The saved dataframe class is not available in the exported graph.`)
    }
    catch (cause) { analysisErrors.push(`${definition.title}: ${cause instanceof Error ? cause.message : String(cause)}`) }
  }
  return {
    version: 1, title, turtle,
    graph: snapshotViewerGraph(store),
    model: buildBrowseModel(store, shapes, input.sources),
    profiles: profiles.map(profile => ({ iri: profile.iri, turtle: profile.rawTurtle })),
    dataframes, charts: explore.charts, analysisErrors,
  }
}
