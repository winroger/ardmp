import type { PipelineState } from '@/core/pipeline/PipelineState'
import { buildRoCratePackage, type ExportPackage } from '@/services/export/exportService'
import { pipelineStateToExportInput } from '@/services/pipeline/pipelineExportAdapter'

export async function buildRoCrateFromPipelineState(state: PipelineState): Promise<ExportPackage> {
  return buildRoCratePackage(pipelineStateToExportInput(state))
}
