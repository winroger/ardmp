import { graph, type Store, type Statement } from 'rdflib'

/** Retain matching roots and their outgoing linked data, including blank nodes. */
export function buildReviewSubgraph(store: Store, roots: readonly string[], excludedRoots: ReadonlySet<string> = new Set()): Store {
  const result = graph()
  for (const [prefix, namespace] of Object.entries(store.namespaces ?? {})) result.setPrefixForURI(prefix, namespace)
  const bySubject = new Map<string, Statement[]>()
  const byValue = new Map<string, string[]>()
  for (const statement of store.statements) {
    const key = `${statement.subject.termType}:${statement.subject.value}`
    const statements = bySubject.get(key)
    if (statements) statements.push(statement)
    else {
      bySubject.set(key, [statement])
      byValue.set(statement.subject.value, [...byValue.get(statement.subject.value) ?? [], key])
    }
  }
  const queue = roots.flatMap(iri => byValue.get(iri) ?? [])
  const visited = new Set<string>()
  const selected = new Set(roots)
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index]
    if (visited.has(key)) continue
    visited.add(key)
    for (const statement of bySubject.get(key) ?? []) {
      result.add(statement.subject, statement.predicate, statement.object, statement.graph)
      const object = statement.object
      if (object.termType !== 'NamedNode' && object.termType !== 'BlankNode') continue
      // A backlink must not pull rejected records of the selected class back
      // into the result. Its IRI remains a valid reference without a description.
      if (excludedRoots.has(object.value) && !selected.has(object.value)) continue
      const target = `${object.termType}:${object.value}`
      if (bySubject.has(target) && !visited.has(target)) queue.push(target)
    }
  }
  return result
}
