import type { PipelineState } from '@/core/pipeline/PipelineState'
import { MappingState } from '@/domain/Mapping'
import type { ExportInput } from '@/services/export/exportService'
import { cloneExploreSnapshot, cloneMappingEdges, cloneStagingColumns } from '@/services/project/projectSnapshot'

export function pipelineStateToMapping(state: PipelineState): MappingState {
  const mapping = new MappingState()
  mapping.edges = cloneMappingEdges(state.mappingEdges)
  mapping.subjectIdentifiers = state.subjectIdentifiers?.map(identifier => ({ ...identifier })) ?? []
  if (state.stagingColumns) mapping.stagingColumns = cloneStagingColumns(state.stagingColumns)
  return mapping
}

export function pipelineStateToExportInput(state: PipelineState): ExportInput {
  const mapping = pipelineStateToMapping(state)

  return {
    projectTitle: state.projectTitle,
    ap: state.ap,
    profiles: [...state.profiles],
    sources: [...state.sources],
    mapping,
    metadataTurtle: state.metadataTurtle,
    explore: state.explore ? cloneExploreSnapshot(state.explore) : undefined,
  }
}
