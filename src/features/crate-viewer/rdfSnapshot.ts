import { blankNode, graph, literal, namedNode, type BlankNode, type Collection, type Literal, type NamedNode, type Store } from 'rdflib'

type Resource = { iri: string } | { blank: string }
type Value = Resource | { value: string; datatype: string; language?: string }
export interface RdfSnapshot {
  namespaces: Record<string, string>
  statements: [Resource, string, Value, Resource | null][]
}

/** Expand rdflib collections into triples, keeping all resource identifiers. */
export function normalizeViewerGraph(source: Store): Store {
  const target = graph()
  Object.assign(target.namespaces, source.namespaces)
  const lists = new Map<Collection, NamedNode | BlankNode>()
  const first = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#first')
  const rest = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#rest')
  const nil = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#nil')
  function expand(term: NamedNode | BlankNode | Literal | Collection): NamedNode | BlankNode | Literal {
    if (term.termType !== 'Collection') return term
    const existing = lists.get(term)
    if (existing) return existing
    if (!term.elements.length) return nil
    let cell = blankNode()
    const head = cell
    lists.set(term, head)
    term.elements.forEach((element, index) => {
      target.add(cell, first, expand(element as NamedNode | BlankNode | Literal | Collection))
      const next = index === term.elements.length - 1 ? nil : blankNode()
      target.add(cell, rest, next)
      cell = next as BlankNode
    })
    return head
  }
  for (const statement of source.statements) target.add(statement.subject, statement.predicate,
    expand(statement.object as NamedNode | BlankNode | Literal | Collection), statement.graph)
  return target
}

function resource(term: { termType: string; value: string }): Resource {
  if (term.termType === 'NamedNode') return { iri: term.value }
  if (term.termType === 'BlankNode') return { blank: term.value }
  throw new Error(`Unsupported RDF resource: ${term.termType}`)
}

export function snapshotViewerGraph(store: Store): RdfSnapshot {
  return {
    namespaces: { ...store.namespaces },
    statements: store.statements.map(statement => [
      resource(statement.subject), statement.predicate.value,
      statement.object.termType === 'Literal'
        ? { value: statement.object.value, datatype: statement.object.datatype.value, language: statement.object.language || undefined }
        : resource(statement.object),
      statement.graph.termType === 'DefaultGraph' ? null : resource(statement.graph),
    ]),
  }
}

/** Avoid Turtle parser-generated blank node changes between export and viewing. */
export function restoreViewerGraph(snapshot: RdfSnapshot): Store {
  const store = graph()
  Object.assign(store.namespaces, snapshot.namespaces)
  const node = (value: Resource) => 'iri' in value ? namedNode(value.iri) : blankNode(value.blank)
  for (const [subject, predicate, object, context] of snapshot.statements) {
    const value = 'value' in object
      ? literal(object.value, object.language || namedNode(object.datatype)) : node(object)
    store.add(node(subject), namedNode(predicate), value, context ? node(context) : undefined)
  }
  return store
}
