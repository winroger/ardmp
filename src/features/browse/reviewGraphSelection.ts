import type { ElementDefinition } from 'cytoscape'

/** Expand only from the original matches, in both directions, by exactly one hop. */
export function reviewGraphSelection(elements: readonly ElementDefinition[], matches: readonly string[], includeConnected: boolean) {
  const nodes = new Map<string, string>()
  for (const { data } of elements) if (data.kind === 'subject') nodes.set(data.id!, data.iri)
  const matched = new Set(matches)
  const visible = new Set(matches)
  if (includeConnected) for (const { data } of elements) {
    const source = nodes.get(data.source), target = nodes.get(data.target)
    if (!source || !target) continue
    if (matched.has(source)) visible.add(target)
    if (matched.has(target)) visible.add(source)
  }
  const visibleIris = [...nodes.values()].filter(iri => visible.has(iri))
  return { visibleIris, connectedIris: visibleIris.filter(iri => !matched.has(iri)) }
}
