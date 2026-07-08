import { describe, expect, it } from 'vitest'
import { graph, parse } from 'rdflib'
import { ApplicationProfile, parseShaclProfile } from '@/domain/NodeShape'
import { buildExploreChartPreview } from '@/services/explore/chartPreview'
import { buildExploreDataframeModel, buildExploreDataset } from '@/services/explore/exploreService'

const PROFILE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <http://example.org/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .

ex:BuildingShape a sh:NodeShape ;
  sh:targetClass ex:Building ;
  sh:property [ sh:path ex:name ; sh:name "Building Name" ] ;
  sh:property [ sh:path ex:buildYear ; sh:name "Build Year" ; sh:datatype xsd:year ] ;
  sh:property [ sh:path ex:height ; sh:name "Height" ; sh:datatype xsd:integer ] ;
  sh:property [ sh:path ex:area ; sh:name "Area" ; sh:datatype xsd:integer ] ;
  sh:property [ sh:path ex:locatedIn ; sh:name "Located In" ; sh:node ex:PlaceShape ] .

ex:PlaceShape a sh:NodeShape ;
  sh:targetClass ex:Place ;
  sh:property [ sh:path ex:placeName ; sh:name "Place Name" ] ;
  sh:property [ sh:path geo:asWKT ; sh:name "Geometry" ; sh:datatype geo:wktLiteral ] ;
  sh:property [ sh:path ex:country ; sh:name "Country" ; sh:node ex:CountryShape ] .

ex:CountryShape a sh:NodeShape ;
  sh:targetClass ex:Country ;
  sh:property [ sh:path ex:countryName ; sh:name "Country Name" ] ;
  sh:property [ sh:path ex:region ; sh:name "Region" ] .
`

const DATA = `
@prefix ex: <http://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .

ex:building-a a ex:Building ;
  ex:name "Building A" ;
  ex:buildYear "1998"^^xsd:year ;
  ex:height "12"^^xsd:integer ;
  ex:area "120"^^xsd:integer ;
  ex:locatedIn ex:place-berlin .

ex:building-b a ex:Building ;
  ex:name "Building B" ;
  ex:buildYear "1985"^^xsd:year ;
  ex:height "20"^^xsd:integer ;
  ex:area "220"^^xsd:integer ;
  ex:locatedIn ex:place-madrid .

ex:place-berlin a ex:Place ;
  ex:placeName "Berlin" ;
  geo:asWKT "POINT(13.405 52.52)"^^geo:wktLiteral ;
  ex:country ex:country-de .

ex:place-madrid a ex:Place ;
  ex:placeName "Madrid" ;
  geo:asWKT "POINT(-3.7038 40.4168)"^^geo:wktLiteral ;
  ex:country ex:country-es .

ex:country-de a ex:Country ;
  ex:countryName "Germany" ;
  ex:region "Europe" .

ex:country-es a ex:Country ;
  ex:countryName "Spain" ;
  ex:region "Europe" .
`

function createLinkedExploreState() {
  const ap = new ApplicationProfile()
  ap.upsert(parseShaclProfile(PROFILE, 'profile.ttl', 'embedded', 'http://example.org/profile'))

  const store = graph()
  parse(DATA, store, 'http://example.org/', 'text/turtle')

  return {
    ap,
    store,
  }
}

describe('exploreService', () => {
  it('builds linked SHACL field definitions from the RDF graph', () => {
    const { ap, store } = createLinkedExploreState()

    const dataset = buildExploreDataset(store, ap.allNodeShapes())
    const buildingClass = dataset.classes.find(entry => entry.classIri === 'http://example.org/Building')

    expect(dataset.classes.length).toBeGreaterThan(0)
    expect(buildingClass).toBeTruthy()
    expect(buildingClass?.subjectCount).toBe(2)
    expect(buildingClass?.fields.some(field => field.label === 'Located In / Place Name')).toBe(true)
    expect(buildingClass?.fields.some(field => field.label === 'Located In / Country / Country Name')).toBe(true)
  })

  it('materializes a linked dataframe and scatter chart configuration', () => {
    const { ap, store } = createLinkedExploreState()
    const dataset = buildExploreDataset(store, ap.allNodeShapes())
    const targetClass = dataset.classes.find(entry => entry.classIri === 'http://example.org/Building')

    expect(targetClass).toBeTruthy()

    const dataframeModel = buildExploreDataframeModel(store, ap.allNodeShapes(), {
      id: 'df-1',
      title: 'Buildings and geography',
      rootClassIri: targetClass!.classIri,
      columns: [
        {
          id: targetClass!.fields.find(field => field.label === 'Building Name')!.id,
          label: 'Building Name',
          path: targetClass!.fields.find(field => field.label === 'Building Name')!.path,
        },
        {
          id: targetClass!.fields.find(field => field.label === 'Height')!.id,
          label: 'Height',
          path: targetClass!.fields.find(field => field.label === 'Height')!.path,
        },
        {
          id: targetClass!.fields.find(field => field.label === 'Area')!.id,
          label: 'Area',
          path: targetClass!.fields.find(field => field.label === 'Area')!.path,
        },
        {
          id: targetClass!.fields.find(field => field.label === 'Located In / Place Name')!.id,
          label: 'Located In / Place Name',
          path: targetClass!.fields.find(field => field.label === 'Located In / Place Name')!.path,
        },
        {
          id: targetClass!.fields.find(field => field.label === 'Located In / Country / Country Name')!.id,
          label: 'Located In / Country / Country Name',
          path: targetClass!.fields.find(field => field.label === 'Located In / Country / Country Name')!.path,
        },
      ],
    })

    expect(dataframeModel).toBeTruthy()
    expect(dataframeModel?.rows).toHaveLength(2)
    expect(dataframeModel?.rows[0]?.values[targetClass!.fields.find(field => field.label === 'Located In / Place Name')!.id]).toBeTruthy()

    const option = buildExploreChartPreview({
      id: 'preview',
      title: 'Preview',
      chartType: 'scatter',
      dataframeId: 'df-1',
      fieldMapping: {
        x: targetClass!.fields.find(field => field.label === 'Height')!.id,
        y: targetClass!.fields.find(field => field.label === 'Area')!.id,
        color: targetClass!.fields.find(field => field.label === 'Located In / Country / Country Name')!.id,
        size: targetClass!.fields.find(field => field.label === 'Area')!.id,
        label: targetClass!.fields.find(field => field.label === 'Building Name')!.id,
        medianLineBasis: 'y',
      },
    }, dataframeModel!)

    expect(option).toBeTruthy()
    expect(option?.kind).toBe('echarts')
    expect(option && option.kind === 'echarts' ? JSON.stringify(option.option.series) : '').toContain('scatter')
  })

  it('builds a geo chart from WKT dataframe values', () => {
    const { ap, store } = createLinkedExploreState()
    const dataset = buildExploreDataset(store, ap.allNodeShapes())
    const targetClass = dataset.classes.find(entry => entry.classIri === 'http://example.org/Building')

    expect(targetClass).toBeTruthy()

    const labelField = targetClass!.fields.find(field => field.label === 'Building Name')!
    const geometryField = targetClass!.fields.find(field => field.label === 'Located In / Geometry')!
    const categoryField = targetClass!.fields.find(field => field.label === 'Located In / Country / Country Name')!
    const sizeField = targetClass!.fields.find(field => field.label === 'Area')!

    expect(geometryField.datatype).toBe('http://www.opengis.net/ont/geosparql#wktLiteral')

    const dataframeModel = buildExploreDataframeModel(store, ap.allNodeShapes(), {
      id: 'df-geo',
      title: 'Buildings on map',
      rootClassIri: targetClass!.classIri,
      columns: [
        { id: labelField.id, label: labelField.label, path: labelField.path },
        { id: geometryField.id, label: geometryField.label, path: geometryField.path },
        { id: categoryField.id, label: categoryField.label, path: categoryField.path },
        { id: sizeField.id, label: sizeField.label, path: sizeField.path },
      ],
    })

    const option = buildExploreChartPreview({
      id: 'preview-geo',
      title: 'Geo Preview',
      chartType: 'geo',
      dataframeId: 'df-geo',
      fieldMapping: {
        geometry: geometryField.id,
        color: categoryField.id,
        size: sizeField.id,
        label: labelField.id,
      },
    }, dataframeModel!)

    expect(option).toBeTruthy()
    expect(option?.kind).toBe('geo')
    expect(option && option.kind === 'geo' ? option.points : []).toHaveLength(2)
    expect(option && option.kind === 'geo' ? option.points[0]?.lng : null).not.toBeNull()
    expect(option && option.kind === 'geo' ? option.points[0]?.lat : null).not.toBeNull()
    expect(option && option.kind === 'geo' ? option.points[0]?.subjects.length : 0).toBe(1)
  })

  it('sorts bar chart categories ascending for numeric and xsd:year fields', () => {
    const { ap, store } = createLinkedExploreState()
    const dataset = buildExploreDataset(store, ap.allNodeShapes())
    const targetClass = dataset.classes.find(entry => entry.classIri === 'http://example.org/Building')

    expect(targetClass).toBeTruthy()

    const heightField = targetClass!.fields.find(field => field.label === 'Height')!
    const yearField = targetClass!.fields.find(field => field.label === 'Build Year')!

    const dataframeModel = buildExploreDataframeModel(store, ap.allNodeShapes(), {
      id: 'df-sort',
      title: 'Sortable categories',
      rootClassIri: targetClass!.classIri,
      columns: [
        { id: heightField.id, label: heightField.label, datatype: heightField.datatype, path: heightField.path },
        { id: yearField.id, label: yearField.label, datatype: yearField.datatype, path: yearField.path },
      ],
    })

    const numericBarOption = buildExploreChartPreview({
      id: 'bar-height',
      title: 'Height order',
      chartType: 'bar',
      dataframeId: 'df-sort',
      fieldMapping: {
        category: heightField.id,
      },
    }, dataframeModel!)

    const yearBarOption = buildExploreChartPreview({
      id: 'bar-year',
      title: 'Year order',
      chartType: 'bar',
      dataframeId: 'df-sort',
      fieldMapping: {
        category: yearField.id,
      },
    }, dataframeModel!)

    expect(numericBarOption && numericBarOption.kind === 'echarts' ? numericBarOption.option.xAxis : null).toMatchObject({ data: ['12', '20'] })
    expect(yearBarOption && yearBarOption.kind === 'echarts' ? yearBarOption.option.xAxis : null).toMatchObject({ data: ['1985', '1998'] })
  })
})