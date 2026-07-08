import { namedNode, type NamedNode, type Store } from 'rdflib'
import { RDF_TYPE } from '@/domain/rdfConstants'
import type { DataSource } from '@/domain/DataSource'
import type { NodeShape, PropertyShape } from '@/domain/NodeShape'
import {
  type ExploreDataframeDefinitionSnapshot,
  type ExploreQueryPathSegmentSnapshot,
} from '@/services/project/projectSnapshot'
import { buildBrowseModel } from '@/services/browse/browseService'
import type { ExploreChartPreviewModel } from '@/services/explore/chartPreview'

export type ExploreFieldKind = 'string' | 'number' | 'resource'

export interface ExploreFieldDefinition {
  id: string
  label: string
  path: ExploreQueryPathSegmentSnapshot[]
  kind: ExploreFieldKind
  datatype?: string
}

const SUBJECT_FIELD_ID = '__subject__'

export function isSubjectField(fieldId: string): boolean {
  return fieldId === SUBJECT_FIELD_ID
}

export interface ExploreClassDefinition {
  classIri: string
  classLabel: string
  fields: ExploreFieldDefinition[]
  subjectCount: number
}

export interface ExploreTableRow {
  subjectIri: string
  subjectLabel: string
  values: Record<string, string | number | null>
}

export interface ExploreDataset {
  classes: ExploreClassDefinition[]
}

export interface ExploreDataframeModel {
  definition: ExploreDataframeDefinitionSnapshot
  rootClassLabel: string
  rows: ExploreTableRow[]
}

export type { ExploreChartPreviewModel }

interface SubjectIndexEntry {
  label: string
}

interface FieldDescriptor {
  path: ExploreQueryPathSegmentSnapshot[]
  label: string
  kind: ExploreFieldKind
  datatype?: string
}

interface ExploreValueTerm {
  termType: string
  value: string
}

const MAX_LINK_DEPTH = 3

function localName(iri: string): string {
  const idx = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'))
  return idx >= 0 ? iri.slice(idx + 1) : iri
}

function isNumericDatatype(datatype: string | undefined): boolean {
  if (!datatype) return false
  return [
    'http://www.w3.org/2001/XMLSchema#decimal',
    'http://www.w3.org/2001/XMLSchema#double',
    'http://www.w3.org/2001/XMLSchema#float',
    'http://www.w3.org/2001/XMLSchema#integer',
    'http://www.w3.org/2001/XMLSchema#int',
    'http://www.w3.org/2001/XMLSchema#long',
    'http://www.w3.org/2001/XMLSchema#nonNegativeInteger',
    'http://www.w3.org/2001/XMLSchema#positiveInteger',
  ].includes(datatype)
}

function propertyLabelFor(property: PropertyShape): string {
  if (property.name) return property.name
  return localName(property.path?.value ?? property.nodeId.value) || property.nodeId.value
}

function classLabelFor(classIri: string, shapes: readonly NodeShape[]): string {
  const shape = shapes.find(entry => entry.targetClass?.value === classIri)
  if (shape?.rdfsLabel) return shape.rdfsLabel
  if (shape?.label) return shape.label
  return localName(classIri) || classIri
}

function fieldKindForProperty(property: PropertyShape): ExploreFieldKind {
  if (property.node || property.cls) return 'resource'
  if (isNumericDatatype(property.datatype?.value)) return 'number'
  return 'string'
}

function fieldIdFromPath(path: readonly ExploreQueryPathSegmentSnapshot[]): string {
  return path.map(segment => segment.predicate).join(' > ')
}

function buildSubjectIndex(
  store: Store,
  shapes: readonly NodeShape[],
  sources: readonly DataSource[],
): Map<string, SubjectIndexEntry> {
  const browseModel = buildBrowseModel(store, shapes, sources)
  const index = new Map<string, SubjectIndexEntry>()
  for (const group of browseModel.groups) {
    for (const subject of group.subjects) {
      index.set(subject.iri, { label: subject.label })
    }
  }
  return index
}

function shapeByTargetClass(shapes: readonly NodeShape[]): Map<string, NodeShape> {
  return new Map(
    shapes
      .filter((shape): shape is NodeShape & { targetClass: NamedNode } => Boolean(shape.targetClass))
      .map(shape => [shape.targetClass.value, shape] as const),
  )
}

function resolveReferencedClassIri(
  property: PropertyShape,
  shapesByClassIri: ReadonlyMap<string, NodeShape>,
  shapes: readonly NodeShape[],
): string | null {
  const candidate = property.cls?.value ?? property.node?.value
  if (!candidate) return null
  if (shapesByClassIri.has(candidate)) return candidate

  const shape = shapes.find(entry => entry.nodeId.value === candidate || entry.targetClass?.value === candidate)
  return shape?.targetClass?.value ?? null
}

function collectFieldDescriptors(
  shape: NodeShape | undefined,
  shapes: readonly NodeShape[],
  shapesByClassIri: ReadonlyMap<string, NodeShape>,
  depth = 0,
  prefix: ExploreQueryPathSegmentSnapshot[] = [],
  labelPrefix: string[] = [],
  seenClasses = new Set<string>(),
): FieldDescriptor[] {
  if (!shape) return []
  const currentClassIri = shape.targetClass?.value
  if (currentClassIri && seenClasses.has(currentClassIri)) return []

  const nextSeen = new Set(seenClasses)
  if (currentClassIri) nextSeen.add(currentClassIri)

  const fields: FieldDescriptor[] = []
  for (const property of shape.properties) {
    if (!property.path) continue

    const segment = {
      predicate: property.path.value,
      label: propertyLabelFor(property),
    }
    const nextPath = [...prefix, segment]
    const nextLabelPrefix = [...labelPrefix, segment.label]
    fields.push({
      path: nextPath,
      label: nextLabelPrefix.join(' / '),
      kind: fieldKindForProperty(property),
      datatype: property.datatype?.value,
    })

    const referencedClassIri = resolveReferencedClassIri(property, shapesByClassIri, shapes)
    if (!referencedClassIri || depth >= MAX_LINK_DEPTH - 1) continue

    fields.push(
      ...collectFieldDescriptors(
        shapesByClassIri.get(referencedClassIri),
        shapes,
        shapesByClassIri,
        depth + 1,
        nextPath,
        nextLabelPrefix,
        nextSeen,
      ),
    )
  }

  return fields
}

function uniqueFields(fields: readonly FieldDescriptor[]): ExploreFieldDefinition[] {
  const byId = new Map<string, FieldDescriptor>()
  for (const field of fields) {
    const id = fieldIdFromPath(field.path)
    if (!byId.has(id)) byId.set(id, field)
  }

  return [{
    id: SUBJECT_FIELD_ID,
    label: 'Subject',
    path: [],
    kind: 'resource' as const,
  }, ...Array.from(byId.values())
    .map(field => ({
      id: fieldIdFromPath(field.path),
      label: field.label,
      path: field.path.map(segment => ({ ...segment })),
      kind: field.kind,
      datatype: field.datatype,
    }))
    .sort((left, right) => left.label.localeCompare(right.label))]
}

function subjectIrisForClass(store: Store, classIri: string): string[] {
  const statements = store.match(null, RDF_TYPE, namedNode(classIri), null)
  const iris = new Set<string>()
  for (const statement of statements) {
    if (statement.subject.termType === 'NamedNode' || statement.subject.termType === 'BlankNode') {
      iris.add(statement.subject.value)
    }
  }
  return Array.from(iris)
}

function termToDisplayValue(term: ExploreValueTerm, subjectIndex: ReadonlyMap<string, SubjectIndexEntry>): string {
  if (term.termType === 'NamedNode' || term.termType === 'BlankNode') {
    return subjectIndex.get(term.value)?.label ?? localName(term.value) ?? term.value
  }
  return term.value
}

function valuesForPath(
  store: Store,
  subjectIri: string,
  path: readonly ExploreQueryPathSegmentSnapshot[],
): ExploreValueTerm[] {
  if (path.length === 0) return [namedNode(subjectIri)]

  let currentTerms: ExploreValueTerm[] = [namedNode(subjectIri)]
  for (const segment of path) {
    const nextTerms: ExploreValueTerm[] = []
    for (const term of currentTerms) {
      if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') continue
      const statements = store.match(term as NamedNode, namedNode(segment.predicate), null, null)
      for (const statement of statements) nextTerms.push(statement.object)
    }
    currentTerms = nextTerms
    if (currentTerms.length === 0) break
  }
  return currentTerms
}

function collapseValues(
  terms: readonly ExploreValueTerm[],
  subjectIndex: ReadonlyMap<string, SubjectIndexEntry>,
  preferredKind: ExploreFieldKind,
): string | number | null {
  if (terms.length === 0) return null
  const displayValues = terms.map(term => termToDisplayValue(term, subjectIndex)).filter(Boolean)
  if (displayValues.length === 0) return null

  if (preferredKind === 'number' && displayValues.length === 1) {
    const numericValue = Number(displayValues[0])
    if (!Number.isNaN(numericValue)) return numericValue
  }

  return displayValues.join(' | ')
}

export function buildExploreDataset(
  store: Store,
  shapes: readonly NodeShape[],
  sources: readonly DataSource[] = [],
): ExploreDataset {
  const shapesByClassIri = shapeByTargetClass(shapes)
  const classes = Array.from(shapesByClassIri.keys())
    .map(classIri => ({
      classIri,
      classLabel: classLabelFor(classIri, shapes),
      fields: uniqueFields(collectFieldDescriptors(shapesByClassIri.get(classIri), shapes, shapesByClassIri)),
      subjectCount: subjectIrisForClass(store, classIri).length,
    }))
    .filter(classDefinition => classDefinition.subjectCount > 0 || classDefinition.fields.length > 0)
    .sort((left, right) => left.classLabel.localeCompare(right.classLabel))

  void sources
  return { classes }
}

export function buildExploreDataframeModel(
  store: Store,
  shapes: readonly NodeShape[],
  dataframe: ExploreDataframeDefinitionSnapshot,
  sources: readonly DataSource[] = [],
): ExploreDataframeModel | null {
  const dataset = buildExploreDataset(store, shapes, sources)
  const classDefinition = dataset.classes.find(entry => entry.classIri === dataframe.rootClassIri)
  if (!classDefinition) return null

  const normalizedColumns = dataframe.columns.map(column => ({
    ...column,
    datatype: column.datatype ?? classDefinition.fields.find(entry => entry.id === column.id)?.datatype,
  }))

  const subjectIndex = buildSubjectIndex(store, shapes, sources)
  const rows = subjectIrisForClass(store, dataframe.rootClassIri).map(subjectIri => {
    const values: Record<string, string | number | null> = {}

    for (const column of normalizedColumns) {
      const field = classDefinition.fields.find(entry => entry.id === column.id)
      const terms = valuesForPath(store, subjectIri, column.path)
      values[column.id] = collapseValues(terms, subjectIndex, field?.kind ?? 'string')
    }

    return {
      subjectIri,
      subjectLabel: subjectIndex.get(subjectIri)?.label ?? localName(subjectIri) ?? subjectIri,
      values,
    }
  })

  return {
    definition: {
      ...dataframe,
      columns: normalizedColumns,
    },
    rootClassLabel: classDefinition.classLabel,
    rows,
  }
}