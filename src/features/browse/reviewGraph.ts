import type { ElementDefinition } from 'cytoscape'
import type { BrowseModel, BrowseSubject } from '@/services/browse/browseService'
import { relationshipClassColors, relationshipSubjectColor } from './relationshipGraphColors'

/** Only connect subjects that survived the shared Review filters. */
export function buildReviewGraph(model: BrowseModel | null, subjects: readonly BrowseSubject[]) {
  const colors = relationshipClassColors(model)
  const unique = [...new Map(subjects.map(subject => [subject.iri, subject])).values()]
  const groups = new Map<string, { iri: string; label: string; color: string; subjects: BrowseSubject[] }>()
  for (const subject of unique) {
    const type = relationshipSubjectColor(subject, colors)
    if (!groups.has(type.iri)) groups.set(type.iri, { iri: type.iri, label: type.label, color: type.border, subjects: [] })
    groups.get(type.iri)!.subjects.push(subject)
  }
  const types = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
  const columns = Math.min(3, Math.max(1, types.length))
  const spacing = Math.max(180, ...types.map(type => Math.sqrt(type.subjects.length) * 34 + 100))
  const elements: ElementDefinition[] = []
  types.forEach((type, groupIndex) => {
    const center = { x: (groupIndex % columns) * spacing, y: Math.floor(groupIndex / columns) * spacing }
    elements.push({
      data: { id: `group:${type.iri}`, label: `${type.label.toUpperCase()} / ${type.subjects.length}`, color: type.color, kind: 'group' },
      position: { x: center.x, y: center.y - Math.sqrt(type.subjects.length) * 16 - 32 },
      selectable: false, grabbable: false,
    })
    type.subjects.sort((a, b) => a.iri.localeCompare(b.iri)).forEach((subject, index) => {
      const angle = index * 2.399963229728653
      const radius = 16 * Math.sqrt(index)
      elements.push({
        data: { id: `subject:${subject.iri}`, iri: subject.iri, label: subject.label, color: type.color, type: type.iri, kind: 'subject' },
        position: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius },
      })
    })
  })
  const ids = new Set(unique.map(subject => subject.iri))
  const seen = new Set<string>()
  for (const subject of unique) {
    for (const property of subject.properties) {
      if (!property.isResource || !ids.has(property.value)) continue
      const key = JSON.stringify([subject.iri, property.predicate, property.value])
      if (seen.has(key)) continue
      seen.add(key)
      elements.push({ data: {
        id: `edge:${seen.size}`, source: `subject:${subject.iri}`, target: `subject:${property.value}`,
        label: property.label, predicate: property.predicate,
      } })
    }
  }
  return { elements, types, subjectCount: unique.length, edgeCount: seen.size }
}
