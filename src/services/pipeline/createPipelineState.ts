import type { PipelineState } from '@/core/pipeline/PipelineState'
import { cloneExploreSnapshot, cloneMappingEdges, cloneStagingColumns } from '@/services/project/projectSnapshot'

export function createPipelineState(input: PipelineState): PipelineState {
  return {
    ...input,
    profiles: [...input.profiles],
    sources: [...input.sources],
    mappingEdges: cloneMappingEdges(input.mappingEdges),
    subjectIdentifiers: input.subjectIdentifiers?.map(identifier => ({ ...identifier })),
    stagingColumns: input.stagingColumns ? cloneStagingColumns(input.stagingColumns) : undefined,
    explore: input.explore ? cloneExploreSnapshot(input.explore) : undefined,
  }
}
