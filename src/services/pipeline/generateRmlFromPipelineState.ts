import type { PipelineState } from '@/core/pipeline/PipelineState'
import { pipelineStateToMapping } from './pipelineExportAdapter'
import { serializeMappingAsRml } from '@/services/export/rmlSerializer'

export async function generateRmlFromPipelineState(state: PipelineState): Promise<string> {
  const mapping = pipelineStateToMapping(state)
  return serializeMappingAsRml(state.ap, mapping, state.sources)
}
