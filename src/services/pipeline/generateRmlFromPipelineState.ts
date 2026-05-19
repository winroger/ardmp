import type { PipelineState } from '@/core/pipeline/PipelineState'
import { MappingState } from '@/domain/Mapping'
import { serializeMappingAsRml } from '@/services/export/rmlSerializer'

export async function generateRmlFromPipelineState(state: PipelineState): Promise<string> {
  const mapping = new MappingState()
  mapping.edges = [...state.mappingEdges]
  return serializeMappingAsRml(state.ap, mapping, state.sources)
}
