import type { ApplicationProfile, ShaclProfile } from '@/domain/NodeShape'
import type { DataSource } from '@/domain/DataSource'
import type { MappingEdge, SubjectIdentifierMapping } from '@/domain/Mapping'
import type { StagingColumnSelectionState } from '@/services/mapping/stagingSemantics'
import type { ExploreSnapshot } from '@/services/project/projectSnapshot'

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
  subjectIdentifiers?: SubjectIdentifierMapping[]
  stagingColumns?: StagingColumnSelectionState
  explore?: ExploreSnapshot
  metadataTurtle?: string
}
