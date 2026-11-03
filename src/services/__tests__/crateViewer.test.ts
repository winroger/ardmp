import { describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import JSZip from 'jszip'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildRoCrateFromPipelineState } from '@/services/pipeline/buildRoCrateFromPipelineState'
import { createPipelineState } from '@/services/pipeline/createPipelineState'
import { restoreViewerGraph } from '@/features/crate-viewer/rdfSnapshot'
import type { CrateViewerPayload } from '@/features/crate-viewer/types'
import { buildCrateViewerHtml, safeViewerJson } from '@/services/export/crateViewerHtml'
import { crateViewerFixture } from './crateViewerFixture'

// Happy DOM evaluates scripts during DOMParser parsing unless explicitly disabled.
const parser = new (new Window({ settings: { disableJavaScriptEvaluation: true } })).DOMParser()

describe('RO-Crate offline HTML viewer', () => {
  it('packages the exact published data and saved analysis without losing identifiers or disabled columns', async () => {
    const input = crateViewerFixture()
    const state = createPipelineState({ ...input, mappingEdges: input.mapping.edges,
      subjectIdentifiers: input.mapping.subjectIdentifiers, stagingColumns: input.mapping.stagingColumns })
    const result = await buildRoCrateFromPipelineState(state)
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const html = await zip.file('ro-crate-preview.html')!.async('string')
    const doc = parser.parseFromString(html, 'text/html')
    const payload = JSON.parse(doc.querySelector('#ardmp-viewer-data')!.textContent!) as CrateViewerPayload
    expect(payload.turtle).toBe(await zip.file('data/dataset.ttl')!.async('string'))
    expect(payload.turtle).toContain('building-one')
    expect(payload.turtle).not.toContain('recAAA')
    expect(JSON.stringify(payload)).not.toContain('Not in viewer')
    expect(payload.charts).toHaveLength(3)
    expect(payload.dataframes[0].rows).toHaveLength(3)
    expect(payload.dataframes[0].rows[0].subjectIri).toContain('/Building/building-')
    expect(payload.model.groups.find(group => group.classIri === 'http://example.org/Building')?.count).toBe(3)
    expect(restoreViewerGraph(payload.graph).statements.length).toBeGreaterThan(15)
    expect(doc.querySelectorAll('script[src], link[rel="stylesheet"]')).toHaveLength(0)
    expect(doc.querySelector('header h1')?.textContent).toBe(input.projectTitle)
    const metadata = JSON.parse(await zip.file('ro-crate-metadata.json')!.async('string'))
    const root = metadata['@graph'].find((entity: Record<string, unknown>) => entity['@id'] === './')
    expect(root.subjectOf).toEqual({ '@id': 'ro-crate-preview.html' })
    expect(root.hasPart).not.toContainEqual({ '@id': 'ro-crate-preview.html' })
    expect(root.hasPart).toContainEqual({ '@id': 'analysis/charts.json' })
    expect(root.hasPart).toContainEqual({ '@id': 'analysis/dataframes.json' })
    expect(JSON.parse(await zip.file('analysis/charts.json')!.async('string'))).toHaveLength(3)
    const target = process.env.ARDMP_VIEWER_ARTIFACT_DIR
    if (target) {
      mkdirSync(target, { recursive: true })
      for (const file of Object.values(zip.files).filter(file => !file.dir)) {
        const destination = path.join(target, file.name)
        mkdirSync(path.dirname(destination), { recursive: true })
        writeFileSync(destination, await file.async('nodebuffer'))
      }
      writeFileSync(path.join(target, 'example-ro-crate.zip'), Buffer.from(await result.blob.arrayBuffer()))
    }
  })

  it('escapes dataset content so it cannot terminate inline JSON or inject static HTML', () => {
    const attack = '</script><script>window.injected=true</script><img src=x onerror=alert(1)>'
    expect(JSON.parse(safeViewerJson({ value: attack })).value).toBe(attack)
    const payload = { version: 1, title: attack, turtle: attack } as CrateViewerPayload
    const html = buildCrateViewerHtml(payload, { name: attack, description: attack, datePublished: '2026-10-28', license: 'javascript:alert(1)' })
    const doc = parser.parseFromString(html, 'text/html')
    expect(doc.querySelectorAll('script')).toHaveLength(2)
    expect(doc.querySelectorAll('header img, header script')).toHaveLength(0)
    expect(doc.querySelector('header h1')?.textContent).toBe(attack)
    expect(doc.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(JSON.parse(doc.querySelector('#ardmp-viewer-data')!.textContent!).title).toBe(attack)
  })
})
