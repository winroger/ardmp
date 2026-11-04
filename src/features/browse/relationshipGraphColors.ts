import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { localName } from './browseViewHelpers'
import { lightPalette } from '@/styles/brandColors'

export interface RelationshipClassColor {
  iri: string
  label: string
  color: string
  border: string
}

const PALETTE = [
  ['#E2E4FD', '#5865F2'], ['#DDEEE7', '#16856A'], ['#F0DEE8', '#A64D79'],
  ['#DFEBFA', '#3079AE'], ['#FAE8CD', '#B77B20'], ['#E6E0F5', '#7F5AB5'],
  ['#D7ECEE', '#197F8C'], ['#F5DFD8', '#BB5F42'], ['#ECECBF', '#7D8727'],
  ['#EBE0D4', '#896447'], ['#F1DDE9', '#B1488A'], ['#DDE7D4', '#548343'],
]
const UNTYPED: RelationshipClassColor = { iri: '__untyped__', label: 'Untyped', color: lightPalette.surface, border: lightPalette.secondaryText }

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
