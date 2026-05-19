import { describe, expect, it } from 'vitest'
import { buildCanvasStructuralEdges } from '@/features/mapping/canvasGraphBuilders'
import { getEmbeddedExampleProjectSnapshot } from '@/services/project/loadEmbeddedExampleProject'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { restoreDataSourcesFromSnapshot } from '@/services/project/projectSnapshot'

describe('canvasGraphBuilders', () => {
  it('creates a structural edge between linked CSV example tables', () => {
    const snapshot = getEmbeddedExampleProjectSnapshot()
    const ap = new ApplicationProfile()
    for (const profile of snapshot.shapeProfiles) {
      ap.upsert(parseShaclProfile(profile.rawTurtle, profile.source, 'embedded', profile.iri))
    }

    const edges = buildCanvasStructuralEdges(restoreDataSourcesFromSnapshot(snapshot.sources), ap.allNodeShapes())

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'src:buildings.csv',
        target: 'src:locations.csv',
        sourceHandle: 'h:Location',
      }),
    ]))
  })
})
