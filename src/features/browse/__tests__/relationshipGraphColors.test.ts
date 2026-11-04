import { describe, expect, it } from 'vitest'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { relationshipClassColors, relationshipSubjectColor } from '@/features/browse/relationshipGraphColors'

const subject = (iri: string, classes: string[]): BrowseSubject => ({ iri, classes, label: iri, properties: [] })

describe('relationship graph class colors', () => {
  it('assigns different colors to classes and preserves them across navigation and group ordering', () => {
    const building = subject('urn:b', ['urn:Building'])
    const organization = subject('urn:o', ['urn:Organization'])
    const model: BrowseModel = { totalSubjects: 2, groups: [
      { classIri: 'urn:Building', classLabel: 'Building', count: 1, subjects: [building] },
      { classIri: 'urn:Organization', classLabel: 'Organization', count: 1, subjects: [organization] },
    ] }
    const colors = relationshipClassColors(model)
    expect(relationshipSubjectColor(building, colors)).toMatchObject({ label: 'Building', color: '#E2E4FD', border: '#5865F2' })
    expect(relationshipSubjectColor(organization, colors)).toMatchObject({ label: 'Organization', color: '#DDEEE7', border: '#16856A' })
    expect(relationshipClassColors({ ...model, groups: [...model.groups].reverse() })).toEqual(colors)
    expect(relationshipSubjectColor(subject('urn:b2', ['urn:Building']), colors)).toEqual(relationshipSubjectColor(building, colors))
  })

  it('uses a consistent primary class for multiple types and a neutral color for untyped subjects', () => {
    const organization = subject('urn:o', ['urn:Organization', 'urn:Agent'])
    const model: BrowseModel = { totalSubjects: 1, groups: [{ classIri: 'urn:Organization', classLabel: 'Organization', count: 1, subjects: [organization] }] }
    expect(relationshipSubjectColor(organization, relationshipClassColors(model)).iri).toBe('urn:Agent')
    expect(organization.classes).toEqual(['urn:Organization', 'urn:Agent'])
    expect(relationshipSubjectColor(subject('urn:x', []), relationshipClassColors(null))).toMatchObject({ label: 'Untyped', color: '#EFF0EA' })
  })
})
