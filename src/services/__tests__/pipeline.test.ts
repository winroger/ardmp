import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createPipelineState } from '@/services/pipeline/createPipelineState'
import { pipelineStateToExportInput } from '@/services/pipeline/pipelineExportAdapter'
import { buildRoCrateFromPipelineState } from '@/services/pipeline/buildRoCrateFromPipelineState'
import { generateRdfFromPipelineState } from '@/services/pipeline/generateRdfFromPipelineState'
import { generateRmlFromPipelineState } from '@/services/pipeline/generateRmlFromPipelineState'
import { crateViewerFixture } from './crateViewerFixture'
import {
  createMinimalExportApplicationProfile,
  createMinimalExportMapping,
  createMinimalExportProfile,
  createMinimalExportSource,
  readMinimalExportFixture,
} from '@/services/__tests__/minimalExportFixture'

function createFixturePipelineState() {
  const profile = createMinimalExportProfile()
  return createPipelineState({
    projectTitle: 'Minimal export fixture',
    ap: createMinimalExportApplicationProfile(),
    profiles: [profile],
    sources: [createMinimalExportSource()],
    mappingEdges: createMinimalExportMapping().edges,
    metadataTurtle: readMinimalExportFixture('metadata.ttl'),
  })
}

describe('pipeline services', () => {
  it('preserves and isolates identifier, staging and saved-analysis settings across export adaptation', () => {
    const input = crateViewerFixture()
    const state = createPipelineState({ ...input, mappingEdges: input.mapping.edges,
      subjectIdentifiers: input.mapping.subjectIdentifiers, stagingColumns: input.mapping.stagingColumns })
    const exported = pipelineStateToExportInput(state)
    expect(exported.mapping.subjectIdentifiers).toEqual(input.mapping.subjectIdentifiers)
    expect(exported.mapping.stagingColumns).toEqual(input.mapping.stagingColumns)
    expect(exported.explore).toEqual(input.explore)
    exported.mapping.subjectIdentifiers[0].header = 'changed'
    exported.mapping.stagingColumns.inactiveColumnsBySource.buildings.push('changed')
    exported.explore!.dataframes[0].columns[0].path[0].label = 'changed'
    expect(state.subjectIdentifiers![0].header).toBe('PublicKey')
    expect(state.stagingColumns!.inactiveColumnsBySource.buildings).not.toContain('changed')
    expect(state.explore!.dataframes[0].columns[0].path[0].label).toBe('Name')
    state.subjectIdentifiers![0].header = 'snapshot change'
    state.stagingColumns!.inactiveColumnsBySource.buildings.push('snapshot change')
    state.explore!.dataframes[0].columns[0].path[0].label = 'snapshot change'
    expect(input.mapping.subjectIdentifiers[0].header).toBe('PublicKey')
    expect(input.mapping.stagingColumns.inactiveColumnsBySource.buildings).not.toContain('snapshot change')
    expect(input.explore.dataframes[0].columns[0].path[0].label).toBe('Name')
  })

  it('creates a plain PipelineState snapshot from current runtime-like input', () => {
    const pipelineState = createFixturePipelineState()

    expect(pipelineState.projectTitle).toBe('Minimal export fixture')
    expect(pipelineState.profiles).toHaveLength(1)
    expect(pipelineState.sources).toHaveLength(1)
    expect(pipelineState.mappingEdges).toHaveLength(3)
    expect(pipelineState.metadataTurtle).toContain('Minimal Buildings Dataset')
  })

  it('adapts PipelineState to ExportInput without losing mapping edges', () => {
    const pipelineState = createFixturePipelineState()
    const exportInput = pipelineStateToExportInput(pipelineState)

    expect(exportInput.projectTitle).toBe(pipelineState.projectTitle)
    expect(exportInput.mapping.edges).toEqual(pipelineState.mappingEdges)
    expect(exportInput.sources).toEqual(pipelineState.sources)
  })

  it('builds an RO-Crate package from PipelineState through the existing export implementation', async () => {
    const pipelineState = createFixturePipelineState()
    const result = await buildRoCrateFromPipelineState(pipelineState)
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    expect(result.subjectCount).toBe(2)
    expect(zip.file('ro-crate-metadata.json')).toBeTruthy()
    expect(zip.file('mapping/mapping.rml.ttl')).toBeTruthy()
    expect(zip.file('mapping/mapping.json')).toBeNull()
  })

  it('generates RDF from PipelineState with the current RDF generator behavior', async () => {
    const pipelineState = createFixturePipelineState()
    const result = await generateRdfFromPipelineState(pipelineState)

    expect(result.subjectCount).toBe(2)
    expect(result.tripleCount).toBe(10)
    expect(result.turtle).toContain('Building A')
    expect(result.turtle).toContain('building-b')
  })

  it('generates RML from PipelineState with the current RML serializer behavior', async () => {
    const pipelineState = createFixturePipelineState()
    const rml = await generateRmlFromPipelineState(pipelineState)

    expect(rml).toContain('rml:source "sources/source_csv.csv"')
    expect(rml).toContain('rr:template "http://example.org/Building/{id}"')
  })
})
