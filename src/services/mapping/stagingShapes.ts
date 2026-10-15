import { parseShaclProfile, type NodeShape, type PropertyShape, type ShaclProfile } from '@/domain/NodeShape'
import type { DataSource, DataSourceColumnDatatype } from '@/domain/DataSource'
import type { MappingState } from '@/domain/Mapping'
import {
  ARDMP_STAGING_CLASS_BASE,
  ARDMP_STAGING_PROPERTY_BASE,
  hybridTargetClassForOwner,
  isStagingSource,
  resolveExplicitHybridOwnerForSource,
  stagingClassForSource,
  stagingColumnsForSourceWithRelations,
} from '@/services/mapping/stagingSemantics'

const STAGING_PROFILE_IRI = 'https://w3id.org/ardmp/staging/profile/runtime'
const STAGING_SHAPE_BASE = 'https://w3id.org/ardmp/staging/shape/'
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean'
const XSD_DATE = 'http://www.w3.org/2001/XMLSchema#date'
const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const XSD_DECIMAL = 'http://www.w3.org/2001/XMLSchema#decimal'
const XSD_DURATION = 'http://www.w3.org/2001/XMLSchema#duration'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

export interface RuntimeStagingShapes {
  profile: ShaclProfile | null
  nodeShapes: NodeShape[]
  turtle: string
}

export function buildRuntimeStagingShapes(
  sources: DataSource[],
  mapping: MappingState,
  baseShapes: readonly NodeShape[] = [],
): RuntimeStagingShapes {
  const hybridOwnersBySourceId = new Map(
    sources
      .map(source => [source.id, resolveExplicitHybridOwnerForSource(source, mapping, baseShapes, sources)] as const)
      .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof resolveExplicitHybridOwnerForSource>>] => Boolean(entry[1])),
  )

  const shapeBlocks = sources
    .filter(source => isStagingSource(source))
    .map(source => buildShapeBlock(source, mapping, sources, hybridOwnersBySourceId))
    .filter((block): block is string => Boolean(block))

  if (shapeBlocks.length === 0) {
    return {
      profile: null,
      nodeShapes: [],
      turtle: '',
    }
  }

  const turtle = [
    '@prefix sh: <http://www.w3.org/ns/shacl#> .',
    '@prefix dct: <http://purl.org/dc/terms/> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix ardmp_class: <https://w3id.org/ardmp/staging/class/> .',
    '@prefix ardmp_prop: <https://w3id.org/ardmp/staging/property/> .',
    '',
    ...shapeBlocks,
    '',
  ].join('\n')

  const profile = parseShaclProfile(turtle, 'generated:staging-shapes', 'embedded', STAGING_PROFILE_IRI)
  return {
    profile,
    nodeShapes: profile.nodeShapes,
    turtle,
  }
}

function buildShapeBlock(
  source: DataSource,
  mapping: MappingState,
  allSources: DataSource[],
  hybridOwnersBySourceId: ReadonlyMap<string, NonNullable<ReturnType<typeof resolveExplicitHybridOwnerForSource>>>,
): string | null {
  const stagingColumns = stagingColumnsForSourceWithRelations(source, mapping, allSources)
  if (stagingColumns.length === 0) return null

  const hybridOwner = hybridOwnersBySourceId.get(source.id)
  const targetClassIri = hybridOwner
    ? hybridTargetClassForOwner(hybridOwner)?.value
    : stagingClassForSource(source).value
  if (!targetClassIri) return null

  const shapeIri = hybridOwner ? hybridShapeIriForSource(source) : stagingShapeIriForSource(source)
  const shapeLabel = hybridOwner ? `${source.name} hybrid record` : `${source.name} staging record`

  const propertySpecs: PropertyBlockSpec[] = []

  if (hybridOwner) {
    for (const property of uniquePropertiesByPath(hybridOwner.mappedShapes.flatMap(shape => shape.properties))) {
      if (!property.path) continue
      propertySpecs.push({
        name: property.name ?? localNameOf(property.path.value),
        description: property.description,
        path: property.path.value,
        datatype: property.datatype?.value,
        node: property.node?.value,
        nodeKind: property.nodeKind?.value,
      })
    }
  }

  for (const column of stagingColumns) {
    const propertyLocalName = localNameOf(column.property.value)
    const targetSource = column.linkedTargetSourceId
      ? allSources.find(candidate => candidate.id === column.linkedTargetSourceId)
      : undefined
    const linkedTargetHybridOwner = column.linkedTargetSourceId
      ? hybridOwnersBySourceId.get(column.linkedTargetSourceId)
      : undefined
    propertySpecs.push({
      name: column.header,
      description: `Auto-generated staging field for ${source.name} / ${column.header}`,
      path: propertyLocalName,
      pathIsPrefixed: true,
      datatype: column.linkedTargetSourceId ? undefined : stagingDatatypeForColumn(source, column.header),
      node: column.linkedTargetSourceId
        ? (linkedTargetHybridOwner
          ? hybridShapeIriForSource(targetSource ?? { name: column.linkedTargetSourceId })
          : stagingShapeIriForSource(targetSource ?? { name: column.linkedTargetSourceId }))
        : undefined,
      nodeKind: column.linkedTargetSourceId ? 'http://www.w3.org/ns/shacl#IRI' : undefined,
    })
  }

  const propertyBlocks = propertySpecs.map((spec, index) => formatPropertyBlock(spec, index + 1, index === propertySpecs.length - 1))

  return [
    `<${shapeIri}> a sh:NodeShape ;`,
    `  dct:title ${ttlLiteral(shapeLabel)} ;`,
    `  rdfs:label ${ttlLiteral(source.name)} ;`,
    `  dct:description ${ttlLiteral(hybridOwner ? `Runtime-generated hybrid shape for ${source.name}` : `Runtime-generated staging shape for ${source.name}`)} ;`,
    `  sh:targetClass <${targetClassIri}> ;`,
    ...propertyBlocks,
  ].join('\n')
}

interface PropertyBlockSpec {
  name: string
  description?: string
  path: string
  pathIsPrefixed?: boolean
  datatype?: string
  node?: string
  nodeKind?: string
}

function stagingDatatypeForColumn(source: DataSource, header: string): string {
  const datatype = source.columns?.find(column => column.name === header)?.datatype
  return xsdDatatypeForSourceColumn(datatype)
}

function xsdDatatypeForSourceColumn(datatype: DataSourceColumnDatatype | undefined): string {
  switch (datatype) {
    case 'boolean':
      return XSD_BOOLEAN
    case 'date':
      return XSD_DATE
    case 'datetime':
      return XSD_DATE_TIME
    case 'duration':
      return XSD_DURATION
    case 'number':
      return XSD_DECIMAL
    case 'array':
    case 'object':
    case 'string':
    case 'unknown':
    default:
      return XSD_STRING
  }
}

function uniquePropertiesByPath(properties: PropertyShape[]): PropertyShape[] {
  const seen = new Set<string>()
  const unique: PropertyShape[] = []
  for (const property of properties) {
    const key = property.path?.value
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(property)
  }
  return unique
}

function formatPropertyBlock(spec: PropertyBlockSpec, order: number, isLast: boolean): string {
  return [
    '  sh:property [',
    `    sh:name ${ttlLiteral(spec.name)} ;`,
    ...(spec.description ? [`    dct:description ${ttlLiteral(spec.description)} ;`] : []),
    spec.pathIsPrefixed ? `    sh:path ardmp_prop:${spec.path} ;` : `    sh:path <${spec.path}> ;`,
    ...(spec.node ? [`    sh:node <${spec.node}> ;`] : []),
    ...(spec.nodeKind ? [`    sh:nodeKind <${spec.nodeKind}> ;`] : []),
    ...(spec.datatype ? [`    sh:datatype <${spec.datatype}> ;`] : []),
    `    sh:order ${order}`,
    `  ]${isLast ? ' .' : ' ;'}`,
  ].join('\n')
}

function slugFromSourceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'source'
}

export function stagingShapeIriForSource(source: Pick<DataSource, 'name'>): string {
  return `${STAGING_SHAPE_BASE}${slugFromSourceName(source.name)}`
}

export function hybridShapeIriForSource(source: Pick<DataSource, 'name'>): string {
  return `${STAGING_SHAPE_BASE}${slugFromSourceName(source.name)}-hybrid`
}

function localNameOf(iri: string): string {
  const idx = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'))
  return idx >= 0 ? iri.slice(idx + 1) : iri
}

function ttlLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export {
  ARDMP_STAGING_CLASS_BASE,
  ARDMP_STAGING_PROPERTY_BASE,
  STAGING_PROFILE_IRI,
}
