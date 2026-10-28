import rdf from '@rdfjs/data-model'
import type { Literal, Term } from '@rdfjs/types'
import type { Query, QueryCriterion, QueryFacet, QueryField, QueryPathSegment } from '@ulb-darmstadt/shacl-form'
import type { Store } from 'rdflib'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const NUMERIC = /^(?:decimal|double|float|integer|int|long|short|byte|nonNegativeInteger|positiveInteger|nonPositiveInteger|negativeInteger|unsignedLong|unsignedInt|unsignedShort|unsignedByte)$/

function rangeFamily(datatype: string): string | undefined {
  if (!datatype.startsWith(XSD)) return
  const kind = datatype.slice(XSD.length)
  return NUMERIC.test(kind) ? 'number' : kind === 'date' || kind === 'dateTime' ? kind : undefined
}

/** A binding shared by fields in the same nested shape, including qualified branches. */
export interface QueryScope {
  key: string
  depth: number
  classes: string[]
  fixed: { path: QueryPathSegment; value: Term }[]
}

export interface ReviewQueryField extends QueryField {
  scopes?: QueryScope[]
}

export interface ReviewQuery {
  query: Query
  fields: ReviewQueryField[]
}

interface InputTerm { termType: string; value: string; language?: string; datatype?: { value: string } }
interface EvaluationNode {
  segment?: QueryPathSegment
  checks: ((term: Term) => boolean)[]
  children: Map<string, EvaluationNode>
  probe?: boolean
}

function termKey(term: Term): string {
  const literal = term as Literal
  return JSON.stringify([term.termType, canonicalValue(term), literal.language?.toLowerCase(), literal.datatype?.value])
}

function canonicalValue(term: InputTerm): string {
  // rdflib canonicalizes Turtle booleans to 1/0; the form emits true/false.
  if (term.datatype?.value === `${XSD}boolean`) {
    if (term.value === '1') return 'true'
    if (term.value === '0') return 'false'
  }
  return term.value
}

function toTerm(term: InputTerm): Term {
  if (term.termType === 'NamedNode') return rdf.namedNode(term.value)
  if (term.termType === 'BlankNode') return rdf.blankNode(term.value)
  return term.language ? rdf.literal(term.value, term.language)
    : rdf.literal(canonicalValue(term), rdf.namedNode(term.datatype?.value ?? `${XSD}string`))
}

function comparable(term: Term): { family: string; value: number } | undefined {
  if (term.termType !== 'Literal') return
  const datatype = (term as Literal).datatype.value
  if (!datatype.startsWith(XSD)) return
  const kind = datatype.slice(XSD.length)
  if (NUMERIC.test(kind)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(term.value)) return
    const value = Number(term.value)
    return Number.isFinite(value) ? { family: 'number', value } : undefined
  }
  if (kind === 'date' || kind === 'dateTime') {
    // Treat timezone-free dates/times as UTC, independently of the browser's locale.
    const lexical = kind === 'date' ? term.value.replace(/(Z|[+-]\d\d:\d\d)?$/, 'T00:00:00$1') : term.value
    const value = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(lexical) ? lexical : `${lexical}Z`)
    return Number.isFinite(value) ? { family: kind, value } : undefined
  }
}

function criterionMatches(term: Term, criterion: QueryCriterion): boolean {
  if (criterion.operator === 'equals') return Boolean(criterion.value && termKey(term) === termKey(criterion.value))
  if (criterion.operator === 'contains') {
    if (!criterion.value || !term.value.toLowerCase().includes(criterion.value.value.toLowerCase())) return false
    const language = (criterion.value as Literal).language?.toLowerCase()
    const actual = (term as Literal).language?.toLowerCase() ?? ''
    return !language || actual === language || actual.startsWith(`${language}-`)
  }
  const actual = comparable(term)
  if (!actual || (!criterion.min && !criterion.max)) return false
  return [criterion.min, criterion.max].every((bound, index) => {
    if (!bound) return true
    const other = comparable(bound)
    return other?.family === actual.family && (index === 0 ? actual.value >= other.value : actual.value <= other.value)
  })
}

/** An immutable, indexed view of one generated RDF graph. No Vue or Turtle round trips. */
export class ReviewQueryIndex {
  private readonly adjacency = new Map<string, Map<string, Term[]>>()
  private readonly subjects = new Map<string, Term>()
  private readonly neighbors = new Map<string, Term[]>()

  constructor(store: Pick<Store, 'statements'>, private readonly labels: ReadonlyMap<string, string> = new Map()) {
    for (const statement of store.statements) {
      const subject = toTerm(statement.subject)
      const object = toTerm(statement.object)
      this.subjects.set(subject.value, subject)
      const key = termKey(subject)
      let predicates = this.adjacency.get(key)
      if (!predicates) this.adjacency.set(key, predicates = new Map())
      const predicate = statement.predicate.value
      const values = predicates.get(predicate) ?? []
      if (!values.some(value => termKey(value) === termKey(object))) values.push(object)
      predicates.set(predicate, values)
    }
  }

  private values(subject: Term, segment: QueryPathSegment): Term[] {
    const predicates = typeof segment === 'string' ? [segment] : [...segment].sort()
    const key = JSON.stringify([termKey(subject), predicates])
    let values = this.neighbors.get(key)
    if (!values) {
      const available = this.adjacency.get(termKey(subject))
      values = [...new Map(predicates.flatMap(predicate => available?.get(predicate) ?? []).map(value => [termKey(value), value])).values()]
      this.neighbors.set(key, values)
    }
    return values
  }

  private plan(query: Query, fields: ReviewQueryField[], probe?: ReviewQueryField): EvaluationNode {
    const root: EvaluationNode = { checks: [], children: new Map() }
    const byId = new Map(fields.map(field => [field.id, field]))
    const appliedScopes = new WeakMap<EvaluationNode, Set<string>>()
    const applyScope = (node: EvaluationNode, scope: QueryScope) => {
      const applied = appliedScopes.get(node) ?? new Set()
      if (applied.has(scope.key)) return
      applied.add(scope.key)
      appliedScopes.set(node, applied)
      for (const cls of scope.classes) node.checks.push(term => this.values(term, RDF_TYPE).some(value => value.value === cls && value.termType === 'NamedNode'))
      for (const fixed of scope.fixed) node.checks.push(term => this.values(term, fixed.path).some(value => termKey(value) === termKey(fixed.value)))
    }
    const insert = (field: ReviewQueryField, criterion?: QueryCriterion) => {
      let node = root
      for (const scope of field.scopes ?? []) if (scope.depth === 0) applyScope(node, scope)
      field.path.forEach((segment, index) => {
        const scopes = field.scopes?.filter(scope => scope.depth === index + 1) ?? []
        const key = JSON.stringify([typeof segment === 'string' ? segment : [...segment].sort(), field.shapePath?.[index] ?? segment, scopes.map(scope => scope.key)])
        let child = node.children.get(key)
        if (!child) node.children.set(key, child = { segment, checks: [], children: new Map() })
        node = child
        for (const scope of scopes) applyScope(node, scope)
      })
      if (field.fixedValue) node.checks.push(term => termKey(term) === termKey(field.fixedValue!))
      if (criterion) node.checks.push(term => criterionMatches(term, criterion))
      else node.probe = true
    }
    for (const criterion of query.criteria) insert(byId.get(criterion.field.id) ?? criterion.field, criterion)
    if (probe) insert(probe)
    if (query.targetClass) root.checks.push(term => this.values(term, RDF_TYPE).some(value => value.value === query.targetClass && value.termType === 'NamedNode'))
    return root
  }

  private evaluate(node: EvaluationNode, term: Term): Term[] | null {
    if (!node.checks.every(check => check(term))) return null
    const probes = node.probe ? [term] : []
    for (const child of node.children.values()) {
      let found = false
      for (const value of this.values(term, child.segment!)) {
        const matches = this.evaluate(child, value)
        if (matches !== null) { found = true; probes.push(...matches) }
      }
      if (!found) return null
    }
    return probes
  }

  matchingRoots({ query, fields }: ReviewQuery, roots: readonly string[]): Set<string> {
    const plan = this.plan(query, fields)
    return new Set(roots.filter(iri => {
      const subject = this.subjects.get(iri)
      return subject && this.evaluate(plan, subject) !== null
    }))
  }

  facets({ query, fields }: ReviewQuery, roots: readonly string[], signal?: AbortSignal): QueryFacet[] {
    return fields.map(field => {
      signal?.throwIfAborted()
      const plan = this.plan(query, fields, field)
      const buckets = new Map<string, { value: Term; label?: string; count: number }>()
      let count = 0
      let min: Term | undefined
      let max: Term | undefined
      const family = field.datatype ? rangeFamily(field.datatype) : undefined
      for (const iri of new Set(roots)) {
        const subject = this.subjects.get(iri)
        const matches = subject ? this.evaluate(plan, subject) : null
        const values = [...new Map(matches?.map(value => [termKey(value), value]) ?? []).values()]
          .filter(value => !family || comparable(value)?.family === family)
        if (!values.length) continue
        count++
        for (const value of values) {
          const key = termKey(value)
          const bucket = buckets.get(key)
          if (bucket) bucket.count++
          else buckets.set(key, { value, label: this.labels.get(value.value) ?? (value.termType === 'Literal' ? value.value : undefined), count: 1 })
          if (family) {
            if (!min || comparable(value)!.value < comparable(min)!.value) min = value
            if (!max || comparable(value)!.value > comparable(max)!.value) max = value
          }
        }
      }
      return family ? { fieldId: field.id, count, min, max }
        : { fieldId: field.id, count, buckets: [...buckets.values()].sort((a, b) => (a.label ?? a.value.value).localeCompare(b.label ?? b.value.value)) }
    })
  }
}
