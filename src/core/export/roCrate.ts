import { ROCrate } from 'ro-crate'

/**
 * RO-Crate 1.2 metadata builder.
 *
 * Produces a minimal `ro-crate-metadata.json` using the official `ro-crate`
 * library, describing the export bundle as a Dataset with files for SHACL
 * profiles, source tables, the generated RDF graph and the mapping definition.
 */

export interface RoCrateInput {
  /** Human-readable project title (becomes the Dataset's `name`). */
  name: string
  /** Optional description. */
  description?: string
  /** ISO timestamp when the bundle was created. */
  datePublished: string
  /** Files to include in the crate. */
  files: RoCrateFile[]
  /** Optional list of creators/contributors derived from dataset metadata. */
  agents?: Array<{
    id?: string
    name: string
    type: 'Person' | 'Organization'
    url?: string
  }>
  /** Optional license URL. */
  license?: string
}

export interface RoCrateFile {
  /** Path inside the crate (e.g. "data/dataset.ttl"). */
  path: string
  /** Display name. */
  name: string
  /** Optional description. */
  description?: string
  /** IANA media type, e.g. "text/turtle". */
  encodingFormat?: string
  /** Optional URL identifying the conformsTo profile. */
  conformsTo?: string
}

export function buildRoCrateMetadata(input: RoCrateInput): string {
  const crate = new ROCrate()
  const rootDataset = crate.rootDataset

  rootDataset.name = input.name
  rootDataset.datePublished = input.datePublished

  if (input.description) {
    rootDataset.description = input.description
  }

  if (input.files.length > 0) {
    rootDataset.hasPart = input.files.map(file => ({ '@id': file.path }))
  }

  for (const file of input.files) {
    const entity: Record<string, unknown> = {
      '@id': file.path,
      '@type': 'File',
      name: file.name,
    }

    if (file.description) entity.description = file.description
    if (file.encodingFormat) entity.encodingFormat = file.encodingFormat
    if (file.conformsTo) entity.conformsTo = { '@id': file.conformsTo }

    crate.addEntity(entity)
  }

  if (input.agents && input.agents.length > 0) {
    const entities = input.agents.map((agent, index) => {
      const id = resolveAgentId(agent.id, index, agent.name)
      crate.addEntity({
        '@id': id,
        '@type': agent.type,
        name: agent.name,
        ...(agent.url ? { url: agent.url } : {}),
      })
      return { '@id': id }
    })

    rootDataset.creator = entities.length === 1 ? entities[0] : entities
  }

  if (input.license) {
    rootDataset.license = { '@id': input.license }
  }

  return JSON.stringify(crate, null, 2)
}

function resolveAgentId(id: string | undefined, index: number, name: string): string {
  if (!id) return `#agent-${index}-${slug(name)}`
  return looksLikeIri(id) ? id : `#agent-${slug(id)}`
}

function looksLikeIri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
