import type { PipelineState } from '@/core/pipeline/PipelineState'
import { MappingState } from '@/domain/Mapping'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'

export async function generateRdfFromPipelineState(
  state: PipelineState,
): Promise<{
    turtle: string
    subjectCount: number
    tripleCount: number
  }> {
  const mapping = new MappingState()
  mapping.edges = [...state.mappingEdges]

  const result = generateRdf(state.ap, mapping, state.sources)
  const turtle = await serializeGraph(result.store, 'text/turtle')

  return {
    turtle,
    subjectCount: result.subjectCount,
    tripleCount: result.tripleCount,
  }
}
