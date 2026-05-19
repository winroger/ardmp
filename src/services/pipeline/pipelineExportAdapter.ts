import type { PipelineState } from '@/core/pipeline/PipelineState'
import { MappingState } from '@/domain/Mapping'
import type { ExportInput } from '@/services/export/exportService'

export function pipelineStateToExportInput(state: PipelineState): ExportInput {
  const mapping = new MappingState()
  mapping.edges = [...state.mappingEdges]

  return {
    projectTitle: state.projectTitle,
    ap: state.ap,
    profiles: [...state.profiles],
    sources: [...state.sources],
    mapping,
    metadataTurtle: state.metadataTurtle,
  }
}
