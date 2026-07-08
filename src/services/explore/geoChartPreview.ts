import type { ExploreChartDefinitionSnapshot } from '@/services/project/projectSnapshot'
import type { ExploreDataframeModel } from '@/services/explore/exploreService'
import { fieldLabel, isWktField, numericValue, parseWktPoint, stringValue } from '@/services/explore/chartPreviewShared'

export interface ExploreGeoPreviewPoint {
  id: string
  label: string
  lat: number
  lng: number
  colorGroup: string | null
  color: string
  radius: number
  subjects: ExploreGeoPreviewSubject[]
}

export interface ExploreGeoPreviewSubject {
  subjectIri: string
  label: string
}

export interface ExploreGeoPreviewModel {
  kind: 'geo'
  title: string
  geometryLabel: string
  points: ExploreGeoPreviewPoint[]
}

export function buildGeoChartPreview(
  chart: ExploreChartDefinitionSnapshot,
  dataframeModel: ExploreDataframeModel,
): ExploreGeoPreviewModel | null {
  const geometryKey = chart.fieldMapping.geometry
  if (!geometryKey || !isWktField(dataframeModel.definition.columns, geometryKey)) return null

  const colorKey = chart.fieldMapping.color
  const sizeKey = chart.fieldMapping.size
  const labelKey = chart.fieldMapping.label
  const palette = ['#0f766e', '#2563eb', '#ea580c', '#7c3aed', '#dc2626', '#0891b2']
  const colors = new Map<string, string>()

  const sizeValues = dataframeModel.rows
    .map(row => numericValue(sizeKey ? row.values[sizeKey] : null))
    .filter((value): value is number => value !== null)
  const minSizeValue = sizeValues.length > 0 ? Math.min(...sizeValues) : null
  const maxSizeValue = sizeValues.length > 0 ? Math.max(...sizeValues) : null

  function pointRadius(row: { values: Record<string, string | number | null> }): number {
    const sizeValue = numericValue(sizeKey ? row.values[sizeKey] : null)
    if (sizeValue === null || minSizeValue === null || maxSizeValue === null || minSizeValue === maxSizeValue) return 8
    const ratio = (sizeValue - minSizeValue) / (maxSizeValue - minSizeValue)
    return 6 + (ratio * 10)
  }

  const pointsByCoordinate = new Map<string, ExploreGeoPreviewPoint>()
  for (const row of dataframeModel.rows) {
    const coordinate = parseWktPoint(row.values[geometryKey])
    if (!coordinate) continue

    const colorGroup = colorKey ? stringValue(row.values[colorKey], 'Unassigned') : null
    if (colorGroup && !colors.has(colorGroup)) {
      colors.set(colorGroup, palette[colors.size % palette.length])
    }

    const subjectLabel = stringValue(labelKey ? row.values[labelKey] : row.subjectLabel, row.subjectLabel)
    const coordinateKey = `${coordinate.lng}|${coordinate.lat}`
    const nextRadius = pointRadius(row)
    const existingPoint = pointsByCoordinate.get(coordinateKey)

    if (existingPoint) {
      existingPoint.radius = Math.max(existingPoint.radius, nextRadius)
      existingPoint.subjects.push({
        subjectIri: row.subjectIri,
        label: subjectLabel,
      })
      continue
    }

    pointsByCoordinate.set(coordinateKey, {
      id: coordinateKey,
      label: subjectLabel,
      lat: coordinate.lat,
      lng: coordinate.lng,
      colorGroup,
      color: colorGroup ? (colors.get(colorGroup) ?? '#0f766e') : '#0f766e',
      radius: nextRadius,
      subjects: [{
        subjectIri: row.subjectIri,
        label: subjectLabel,
      }],
    })
  }

  const points = Array.from(pointsByCoordinate.values())
    .map(point => ({
      ...point,
      label: point.subjects.length === 1 ? point.subjects[0].label : `${point.subjects.length} records at this location`,
      subjects: [...point.subjects].sort((left, right) => left.label.localeCompare(right.label)),
    }))

  if (points.length === 0) return null

  return {
    kind: 'geo',
    title: chart.title,
    geometryLabel: fieldLabel(dataframeModel.definition.columns, geometryKey, 'Geometry'),
    points,
  }
}