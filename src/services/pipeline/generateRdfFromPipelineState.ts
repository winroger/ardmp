import type { PipelineState } from '@/core/pipeline/PipelineState'
import { pipelineStateToMapping } from './pipelineExportAdapter'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'

export async function generateRdfFromPipelineState(
  state: PipelineState,
): Promise<{
    turtle: string
    subjectCount: number
    tripleCount: number
  }> {
  const mapping = pipelineStateToMapping(state)

  const result = generateRdf(state.ap, mapping, state.sources)
  const turtle = await serializeGraph(result.store, 'text/turtle')

  return {
    turtle,
    subjectCount: result.subjectCount,
    tripleCount: result.tripleCount,
  }
}
