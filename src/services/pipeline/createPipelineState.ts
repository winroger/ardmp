import type { PipelineState } from '@/core/pipeline/PipelineState'

export function createPipelineState(input: PipelineState): PipelineState {
  return {
    ...input,
    profiles: [...input.profiles],
    sources: [...input.sources],
    mappingEdges: [...input.mappingEdges],
  }
}
