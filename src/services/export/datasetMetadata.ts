import { graph, namedNode, parse, type NamedNode, type Node as RdfTerm, type Store } from 'rdflib'

export interface DatasetMetadataAgent {
  id: string
  name: string
  type: 'Person' | 'Organization'
  url?: string
  role?: string
}

export interface DatasetMetadataSummary {
  name?: string
  description?: string
  datePublished?: string
  license?: string
  agents: DatasetMetadataAgent[]
}

const DEFAULT_BASE_URI = 'http://example.org/'
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_LABEL = namedNode('http://www.w3.org/2000/01/rdf-schema#label')
const DCAT_DATASET = namedNode('http://www.w3.org/ns/dcat#Dataset')
const DCAT_HAD_ROLE = namedNode('http://www.w3.org/ns/dcat#hadRole')
const DCT_TITLE = namedNode('http://purl.org/dc/terms/title')
const DCT_DESCRIPTION = namedNode('http://purl.org/dc/terms/description')
const DCT_IDENTIFIER = namedNode('http://purl.org/dc/terms/identifier')
const DCT_ISSUED = namedNode('http://purl.org/dc/terms/issued')
const DCT_LICENSE = namedNode('http://purl.org/dc/terms/license')
const PROV_QUALIFIED_ATTRIBUTION = namedNode('http://www.w3.org/ns/prov#qualifiedAttribution')
const PROV_AGENT = namedNode('http://www.w3.org/ns/prov#agent')
const FOAF_NAME = namedNode('http://xmlns.com/foaf/0.1/name')
const FOAF_PERSON = 'http://xmlns.com/foaf/0.1/Person'
const FOAF_ORGANIZATION = 'http://xmlns.com/foaf/0.1/Organisation'
const SCHEMA_NAME = namedNode('http://schema.org/name')
const SCHEMA_IDENTIFIER = namedNode('http://schema.org/identifier')
const SCHEMA_URL = namedNode('http://schema.org/url')
const SCHEMA_ADDRESS = namedNode('http://schema.org/Address')
const SCHEMA_PERSON = 'http://schema.org/Person'
const SCHEMA_ORGANIZATION = 'http://schema.org/Organization'

export function extractDatasetMetadata(turtle: string): DatasetMetadataSummary {
  if (!turtle.trim()) {
    return { agents: [] }
  }

  const store = graph()
  parse(turtle, store, DEFAULT_BASE_URI, 'text/turtle')

  const datasetSubject = findDatasetSubject(store)
  if (!datasetSubject) {
    return { agents: [] }
  }

  return {
    name: preferredLiteralValue(store, datasetSubject, DCT_TITLE),
    description: preferredLiteralValue(store, datasetSubject, DCT_DESCRIPTION),
    datePublished: firstTermValue(store, datasetSubject, DCT_ISSUED),
    license: firstNamedNodeValue(store, datasetSubject, DCT_LICENSE),
    agents: extractAgents(store, datasetSubject),
  }
}

function findDatasetSubject(store: Store): RdfTerm | null {
  return store.any(undefined, RDF_TYPE, DCAT_DATASET, null)
}

function preferredLiteralValue(store: Store, subject: RdfTerm, predicate: NamedNode): string | undefined {
  const literals = store.each(subject as any, predicate, undefined, null)
    .filter((term): term is RdfTerm & { value: string; language?: string } => term.termType === 'Literal')

  if (literals.length === 0) return undefined

  const preferred = literals.find(literal => literal.language === 'de')
    ?? literals.find(literal => literal.language === 'en')
    ?? literals[0]

  return preferred.value
}

function firstTermValue(store: Store, subject: RdfTerm, predicate: NamedNode): string | undefined {
  const term = store.any(subject as any, predicate, undefined, null)
  return term?.value
}

function firstNamedNodeValue(store: Store, subject: RdfTerm, predicate: NamedNode): string | undefined {
  const term = store.any(subject as any, predicate, undefined, null)
  return term?.termType === 'NamedNode' ? term.value : undefined
}

function extractAgents(store: Store, datasetSubject: RdfTerm): DatasetMetadataAgent[] {
  const attributions = store.each(datasetSubject as any, PROV_QUALIFIED_ATTRIBUTION, undefined, null)
  const agents = new Map<string, DatasetMetadataAgent>()

  attributions.forEach((attribution, index) => {
    const agent = store.any(attribution as any, PROV_AGENT, undefined, null)
    if (!agent) return

    const name = firstTermValue(store, agent, FOAF_NAME)
      ?? firstTermValue(store, agent, SCHEMA_NAME)
      ?? firstTermValue(store, agent, RDFS_LABEL)

    if (!name) return

    const roleTerm = store.any(attribution as any, DCAT_HAD_ROLE, undefined, null)
    const role = roleTerm
      ? firstTermValue(store, roleTerm, RDFS_LABEL) ?? roleTerm.value
      : undefined
    const identifier = preferredAgentIdentifier(store, agent)
    const url = firstNamedNodeValue(store, agent, SCHEMA_URL) ?? firstTermValue(store, agent, SCHEMA_ADDRESS)
    const id = identifier ?? (agent.termType === 'NamedNode' ? agent.value : `#metadata-agent-${index}`)

    agents.set(id, {
      id,
      name,
      type: detectAgentType(store, agent),
      url,
      role,
    })
  })

  return Array.from(agents.values())
}

function preferredAgentIdentifier(store: Store, agent: RdfTerm): string | undefined {
  const identifier = firstTermValue(store, agent, DCT_IDENTIFIER)
    ?? firstTermValue(store, agent, SCHEMA_IDENTIFIER)

  if (!identifier) return undefined
  return looksLikeIri(identifier) ? identifier : undefined
}

function looksLikeIri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}

function detectAgentType(store: Store, agent: RdfTerm): 'Person' | 'Organization' {
  const types = store.each(agent as any, RDF_TYPE, undefined, null)
    .filter((term): term is NamedNode => term.termType === 'NamedNode')
    .map(term => term.value)

  if (types.includes(FOAF_PERSON) || types.includes(SCHEMA_PERSON)) return 'Person'
  if (types.includes(FOAF_ORGANIZATION) || types.includes(SCHEMA_ORGANIZATION)) return 'Organization'
  return 'Organization'
}

