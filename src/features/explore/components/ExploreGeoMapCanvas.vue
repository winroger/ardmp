<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CircleMarker, LatLngBoundsExpression, LayerGroup, Map as LeafletMap } from 'leaflet'
import { circleMarker, featureGroup, latLngBounds, map, tileLayer } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { ExploreGeoPreviewModel } from '@/services/explore/geoChartPreview'

const props = withDefaults(defineProps<{
  preview: ExploreGeoPreviewModel
  height?: number | string
}>(), {
  height: 320,
})

const emit = defineEmits<{
  openSubject: [subjectIri: string]
}>()

const host = ref<HTMLDivElement | null>(null)
let leafletMap: LeafletMap | null = null
let pointsLayer: LayerGroup | null = null

const hostStyle = computed(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
}))

function ensureMap(): void {
  if (!host.value || leafletMap) return

  leafletMap = map(host.value, {
    zoomControl: true,
    worldCopyJump: true,
  })

  tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(leafletMap)

  pointsLayer = featureGroup().addTo(leafletMap)
}

function buildPopupContent(point: ExploreGeoPreviewModel['points'][number]): HTMLElement {
  const container = document.createElement('div')
  container.className = 'explore-geo-popup'

  const heading = document.createElement('div')
  heading.className = 'explore-geo-popup__title'
  heading.textContent = point.label
  container.appendChild(heading)

  const coordinates = document.createElement('div')
  coordinates.className = 'explore-geo-popup__coordinates'
  coordinates.textContent = `Lat ${point.lat.toFixed(5)}, Lng ${point.lng.toFixed(5)}`
  container.appendChild(coordinates)

  const list = document.createElement('ul')
  list.className = 'explore-geo-popup__list'

  for (const subject of point.subjects) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'explore-geo-popup__link'
    button.textContent = subject.label
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      emit('openSubject', subject.subjectIri)
    })
    item.appendChild(button)
    list.appendChild(item)
  }

  container.appendChild(list)
  return container
}

function renderPoints(): void {
  ensureMap()
  if (!leafletMap || !pointsLayer) return

  pointsLayer.clearLayers()

  const boundsPoints: [number, number][] = []
  for (const point of props.preview.points) {
    boundsPoints.push([point.lat, point.lng])
    const marker: CircleMarker = circleMarker([point.lat, point.lng], {
      radius: point.radius,
      color: point.color,
      fillColor: point.color,
      fillOpacity: 0.7,
      weight: 1.5,
    })

    marker.bindTooltip(point.label)
    marker.bindPopup(buildPopupContent(point), {
      className: 'explore-geo-popup-shell',
      autoClose: false,
      closeButton: true,
    })
    marker.addTo(pointsLayer)
  }

  if (boundsPoints.length === 0) {
    leafletMap.setView([20, 0], 2)
  } else if (boundsPoints.length === 1) {
    leafletMap.setView(boundsPoints[0], 11)
  } else {
    const bounds: LatLngBoundsExpression = latLngBounds(boundsPoints)
    leafletMap.fitBounds(bounds, { padding: [24, 24] })
  }

  void nextTick(() => {
    leafletMap?.invalidateSize()
  })
}

function handleResize(): void {
  leafletMap?.invalidateSize()
}

onMounted(() => {
  renderPoints()
  window.addEventListener('resize', handleResize)
})

watch(() => props.preview, renderPoints, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  pointsLayer?.clearLayers()
  pointsLayer = null
  leafletMap?.remove()
  leafletMap = null
})
</script>

<template>
  <div ref="host" class="explore-geo-map-canvas" :style="hostStyle" />
</template>

<style scoped lang="scss">
.explore-geo-map-canvas {
  width: 100%;
  min-height: 220px;
  border-radius: 14px;
  overflow: hidden;
}

:deep(.explore-geo-popup-shell .leaflet-popup-content-wrapper) {
  border-radius: 12px;
}

:deep(.explore-geo-popup) {
  min-width: 200px;
}

:deep(.explore-geo-popup__title) {
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 0.25rem;
}

:deep(.explore-geo-popup__coordinates) {
  font-size: 0.8125rem;
  color: #64748b;
  margin-bottom: 0.5rem;
}

:deep(.explore-geo-popup__list) {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

:deep(.explore-geo-popup__link) {
  border: 0;
  background: transparent;
  padding: 0;
  color: #2563eb;
  cursor: pointer;
  text-align: left;
  text-decoration: underline;
  font: inherit;
}
</style>