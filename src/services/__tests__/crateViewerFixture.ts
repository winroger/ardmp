import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { MappingState } from '@/domain/Mapping'
import { airtableSource, csvSource } from '@/test/dataSources'
import type { ExploreSnapshot } from '@/services/project/projectSnapshot'

export function crateViewerFixture() {
  const ex = 'http://example.org/'
  const schema = 'http://schema.org/'
  const ap = new ApplicationProfile()
  const building = parseShaclProfile(`@prefix ex: <${ex}> . @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    ex:BuildingShape a sh:NodeShape; rdfs:label "Building"; sh:targetClass ex:Building;
      sh:property [sh:name "Name"; sh:path <${schema}name>; sh:datatype xsd:string],
        [sh:name "Architect"; sh:path ex:architect; sh:node ex:OrganizationShape],
        [sh:name "Year"; sh:path ex:year; sh:datatype xsd:integer],
        [sh:name "Geometry"; sh:path ex:geometry; sh:datatype <http://www.opengis.net/ont/geosparql#wktLiteral>] .`, 'building.ttl', 'uploaded')
  const organization = parseShaclProfile(`@prefix ex: <${ex}> . @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    ex:OrganizationShape a sh:NodeShape; rdfs:label "Organization"; sh:targetClass ex:Organization;
    sh:property [sh:name "Name"; sh:path <${schema}name>; sh:datatype xsd:string] .`, 'organization.ttl', 'uploaded')
  ap.upsert(building)
  ap.upsert(organization)
  const buildings = airtableSource('buildings', 'Buildings', ['PublicKey', 'Name', 'Architect', 'Year', 'Geometry', 'Unpublished'], [
    ['building-one', 'Timber House', 'org-one', 2001, 'POINT(8.65 49.87)', 'Not in viewer'],
    ['building-two', 'School', 'org-two', 2015, 'POINT(10.4 48.2)', 'Not in viewer'],
    ['building-three', 'Tower', 'org-two', 2020, 'POINT(13.4 52.5)', 'Not in viewer'],
  ], ['recAAA', 'recBBB', 'recCCC'])
  const organizations = csvSource('organizations', 'Organizations', ['Key', 'Name'], [['org-one', 'XY Architects'], ['org-two', 'YZ Architects']])
  const mapping = new MappingState()
  for (const [sourceHeader, propertyPath] of [['Name', `${schema}name`], ['Architect', `${ex}architect`], ['Year', `${ex}year`], ['Geometry', `${ex}geometry`]]) {
    mapping.addOrReplace({ sourceId: buildings.id, sourceHeader, shapeIri: `${ex}BuildingShape`, propertyPath })
  }
  mapping.addOrReplace({ sourceId: organizations.id, sourceHeader: 'Name', shapeIri: `${ex}OrganizationShape`, propertyPath: `${schema}name` })
  mapping.setSubjectIdentifier(`${ex}BuildingShape`, buildings.id, 'PublicKey')
  mapping.setSubjectIdentifier(`${ex}OrganizationShape`, organizations.id, 'Key')
  mapping.setStagingGraphActive(buildings.id, buildings.headers, false)
  mapping.setStagingGraphActive(organizations.id, organizations.headers, false)
  const explore: ExploreSnapshot = {
    dataframes: [{ id: 'buildings-frame', title: 'Building overview', rootClassIri: `${ex}Building`, columns: [
      { id: `${schema}name`, label: 'Building', path: [{ predicate: `${schema}name`, label: 'Name' }] },
      { id: `${ex}year`, label: 'Year', datatype: 'http://www.w3.org/2001/XMLSchema#integer', path: [{ predicate: `${ex}year`, label: 'Year' }] },
      { id: `${ex}architect > ${schema}name`, label: 'Architect', path: [{ predicate: `${ex}architect`, label: 'Architect' }, { predicate: `${schema}name`, label: 'Name' }] },
      { id: `${ex}geometry`, label: 'Location', datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral', path: [{ predicate: `${ex}geometry`, label: 'Location' }] },
    ] }],
    charts: [
      { id: 'bar', title: 'Buildings by architect', chartType: 'bar', dataframeId: 'buildings-frame', fieldMapping: { category: `${ex}architect > ${schema}name` } },
      { id: 'scatter', title: 'Construction years', chartType: 'scatter', dataframeId: 'buildings-frame', fieldMapping: { x: `${ex}year`, y: `${ex}year`, label: `${schema}name` } },
      { id: 'map', title: 'Building locations', chartType: 'geo', dataframeId: 'buildings-frame', fieldMapping: { geometry: `${ex}geometry`, label: `${schema}name` } },
    ],
  }
  return { projectTitle: 'Offline architectural dataset', ap, profiles: [building, organization], sources: [buildings, organizations], mapping, explore }
}
