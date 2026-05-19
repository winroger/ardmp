import type { ApplicationProfile, ShaclProfile } from '@/domain/NodeShape'
import type { DataSource } from '@/domain/DataSource'
import type { MappingEdge } from '@/domain/Mapping'

/**
 * Plain exportable runtime state for the current ARDMP pipeline.
 *
 * This is intentionally close to today's export input and should remain free
 * from Vue, Pinia, and canvas-specific infrastructure.
 */
export interface PipelineState {
  projectTitle: string
  ap: ApplicationProfile
  profiles: ShaclProfile[]
  sources: DataSource[]
  mappingEdges: MappingEdge[]
  metadataTurtle?: string
}
