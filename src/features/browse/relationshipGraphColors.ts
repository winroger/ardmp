import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { localName } from './browseViewHelpers'

export interface RelationshipClassColor {
  iri: string
  label: string
  color: string
  border: string
}

const PALETTE = [
  ['#dbeafe', '#2563eb'], ['#dcfce7', '#15803d'], ['#ffedd5', '#c2410c'],
  ['#f3e8ff', '#9333ea'], ['#ffe4e6', '#be123c'], ['#cffafe', '#0e7490'],
  ['#fef9c3', '#a16207'], ['#e0e7ff', '#4338ca'], ['#fae8ff', '#a21caf'],
  ['#ccfbf1', '#0f766e'],
]
const UNTYPED: RelationshipClassColor = { iri: '__untyped__', label: 'Untyped', color: '#f1f5f9', border: '#64748b' }

/** Use the complete dataset so colors remain consistent when navigating relationships. */
export function relationshipClassColors(model: BrowseModel | null): Map<string, RelationshipClassColor> {
  const groups = model?.groups ?? []
  const labels = new Map(groups.map(group => [group.classIri, group.classLabel]))
  const iris = [...new Set(groups.flatMap(group => group.subjects.flatMap(subject => subject.classes)))].sort()
  return new Map(iris.map((iri, index) => {
    const hue = Math.round(index * 137.508) % 360
    const [color, border] = PALETTE[index] ?? [`hsl(${hue}, 65%, 90%)`, `hsl(${hue}, 65%, 38%)`]
    return [iri, { iri, label: labels.get(iri) ?? localName(iri), color, border }]
  }))
}

export function relationshipSubjectColor(subject: BrowseSubject, colors: ReadonlyMap<string, RelationshipClassColor>): RelationshipClassColor {
  const primary = [...subject.classes].sort()[0]
  return colors.get(primary) ?? UNTYPED
}
