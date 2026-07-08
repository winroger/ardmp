import type { DataSource } from '@/domain/DataSource'
import type { NodeShape } from '@/domain/NodeShape'
import type { MappingState } from '@/domain/Mapping'
import {
  hybridTargetClassForOwner,
  isStagingSource,
  resolveExplicitHybridOwnerForSource,
  stagingClassForSource,
} from '@/services/mapping/stagingSemantics'
import type { ExploreDataframeDefinitionSnapshot } from '@/services/project/projectSnapshot'

function currentRootClassIriForSource(
  source: DataSource,
  mapping: MappingState,
  shapes: readonly NodeShape[],
): string {
  const hybridOwner = resolveExplicitHybridOwnerForSource(source, mapping, shapes)
  return (hybridOwner ? hybridTargetClassForOwner(hybridOwner)?.value : undefined) ?? stagingClassForSource(source).value
}

function inferSourceIdForDataframe(
  dataframe: ExploreDataframeDefinitionSnapshot,
  sources: readonly DataSource[],
  mapping: MappingState,
  shapes: readonly NodeShape[],
): string | undefined {
  if (dataframe.sourceId) return dataframe.sourceId

  return sources
    .filter(source => isStagingSource(source))
    .find(source => {
      const stagingClassIri = stagingClassForSource(source).value
      const currentRootClassIri = currentRootClassIriForSource(source, mapping, shapes)
      return dataframe.rootClassIri === stagingClassIri || dataframe.rootClassIri === currentRootClassIri
    })
    ?.id
}

export function reconcileExploreDataframeDefinition(
  dataframe: ExploreDataframeDefinitionSnapshot,
  sources: readonly DataSource[],
  mapping: MappingState,
  shapes: readonly NodeShape[],
): ExploreDataframeDefinitionSnapshot {
  const sourceId = inferSourceIdForDataframe(dataframe, sources, mapping, shapes)
  if (!sourceId) return dataframe

  const source = sources.find(entry => entry.id === sourceId)
  if (!source || !isStagingSource(source)) {
    return dataframe.sourceId === sourceId ? dataframe : { ...dataframe, sourceId }
  }

  const currentRootClassIri = currentRootClassIriForSource(source, mapping, shapes)
  if (dataframe.rootClassIri === currentRootClassIri && dataframe.sourceId === sourceId) return dataframe

  return {
    ...dataframe,
    rootClassIri: currentRootClassIri,
    sourceId,
  }
}

export function reconcileExploreDataframeDefinitions(
  dataframes: readonly ExploreDataframeDefinitionSnapshot[],
  sources: readonly DataSource[],
  mapping: MappingState,
  shapes: readonly NodeShape[],
): ExploreDataframeDefinitionSnapshot[] {
  return dataframes.map(dataframe => reconcileExploreDataframeDefinition(dataframe, sources, mapping, shapes))
}