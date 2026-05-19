import { describe, expect, it } from 'vitest'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { restoreDataSourcesFromSnapshot } from '@/services/project/projectSnapshot'
import { getEmbeddedExampleProjectSnapshot } from '@/services/project/loadEmbeddedExampleProject'
import { generateRdf } from '@/services/rdf/rdfGenerator'
import { buildBrowseModel } from '@/services/browse/browseService'

describe('browseService', () => {
  it('uses gnd:preferredName as the building label in the minimal showcase example', () => {
    const snapshot = getEmbeddedExampleProjectSnapshot()
    const ap = new ApplicationProfile()
    for (const profile of snapshot.shapeProfiles) {
      ap.upsert(parseShaclProfile(profile.rawTurtle, profile.source, 'embedded', profile.iri))
    }

    const mapping = new MappingState()
    for (const edge of snapshot.mapping.edges) {
      mapping.addOrReplace(edge)
    }

    const generated = generateRdf(ap, mapping, restoreDataSourcesFromSnapshot(snapshot.sources))
    const model = buildBrowseModel(generated.store, ap.allNodeShapes())
    const buildingGroup = model.groups.find(group => group.classIri === 'https://d-nb.info/standards/elementset/gnd#BuildingOrMemorial')

    expect(buildingGroup?.subjects.map(subject => subject.label)).toEqual(
      expect.arrayContaining(['Harbor House', 'Timber Hall']),
    )
  })
})
