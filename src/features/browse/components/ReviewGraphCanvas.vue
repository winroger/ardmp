<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ElementDefinition } from 'cytoscape'
import { layoutReviewNetwork } from '../graphNetworkLayout'
import { resizeGraphViewport, zoomGraphAt, type GraphViewport } from '../graphViewport'
import { graphEdgeDetail } from '../graphEdgeDetail'
import { lightPalette } from '@/styles/brandColors'
import { graphFocus } from '../graphFocus'

const props = defineProps<{ elements: readonly ElementDefinition[]; visibleIris: readonly string[]; matchedIris?: readonly string[]; selectedIri?: string | null; mode: 'type' | 'network'; labels: boolean }>()
const emit = defineEmits<{ openSubject: [iri: string]; zoomChange: [percent: number]; deselect: [] }>()
const host = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null)
const tooltip = ref(''), tooltipPosition = ref({ left: '0px', top: '0px' })
interface Node { id: string; iri: string; label: string; color: string; group: string; x: number; y: number; nx: number; ny: number; visible: boolean; context: boolean }
let nodes: Node[] = []
let edges: Array<{ a: Node; b: Node }> = []
let visibleEdges: typeof edges = []
let theme: { text: string; edge: string; primary: string; font: string } = { text: lightPalette.text, edge: lightPalette.secondaryText, primary: lightPalette.accent, font: 'Quantico, sans-serif' }
let groups: Array<{ label: string; color: string; x: number; y: number; type: string }> = []
let width = 0, height = 0, frame = 0
let view: GraphViewport = { x: 0, y: 0, scale: 1 }
let hover: Node | undefined
let observer: ResizeObserver | undefined
let drag: { id: number; x: number; y: number; ox: number; oy: number; moved: boolean } | undefined
let needsFit = true, disposed = false

function position(node: Node): [number, number] {
  return [view.x + (props.mode === 'type' ? node.x : node.nx) * view.scale, view.y + (props.mode === 'type' ? node.y : node.ny) * view.scale]
}
function draw(): void {
  frame = 0
  const ctx = canvas.value?.getContext('2d')
  if (!ctx || !width || !height) return
  const ratio = canvas.value!.width / width
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height)
  const detail = graphEdgeDetail(view.scale, props.mode, visibleEdges.length)
  const selected = nodes.find(node => node.visible && node.iri === props.selectedIri)
  const focused = graphFocus(selected?.id, visibleEdges.map(({ a, b }) => ({ source: a.id, target: b.id })))
  ctx.strokeStyle = theme.edge; ctx.globalAlpha = focused ? 0.025 : detail.opacity; ctx.lineWidth = 0.5; ctx.beginPath()
  for (let i = 0; i < visibleEdges.length; i += detail.stride) {
    const { a, b } = visibleEdges[i]
    const p = position(a), q = position(b)
    ctx.moveTo(...p); ctx.lineTo(...q)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  if (selected) {
    ctx.strokeStyle = theme.primary; ctx.lineWidth = 1; ctx.globalAlpha = 0.65; ctx.beginPath()
    for (const { a, b } of visibleEdges) {
      if (a !== selected && b !== selected) continue
      ctx.moveTo(...position(a)); ctx.lineTo(...position(b))
    }
    ctx.stroke(); ctx.globalAlpha = 1
  }
  if (hover) {
    ctx.strokeStyle = theme.primary; ctx.lineWidth = 1.1; ctx.beginPath()
    for (const { a, b } of visibleEdges) {
      if (a !== hover && b !== hover) continue
      ctx.moveTo(...position(a)); ctx.lineTo(...position(b))
    }
    ctx.stroke()
  }
  if (props.mode === 'type') {
    const counts = new Map<string, number>()
    for (const node of nodes) if (node.visible) counts.set(node.group, (counts.get(node.group) ?? 0) + 1)
    ctx.font = `11px ${theme.font}`; ctx.textAlign = 'center'
    for (const group of groups) {
      const count = counts.get(group.type)
      if (!count) continue
      ctx.fillStyle = group.color
      ctx.fillText(`${group.label} / ${count}`, view.x + group.x * view.scale, view.y + group.y * view.scale)
    }
    ctx.textAlign = 'left'
  }
  for (const node of nodes) {
    if (!node.visible) continue
    const [x, y] = position(node)
    if (x < -160 || y < -25 || x > width + 25 || y > height + 25) continue
    ctx.globalAlpha = focused && !focused.has(node.id) ? 0.13 : 1
    const radius = 2.8 * Math.sqrt(view.scale) + (node === hover ? 2 : 0)
    ctx.fillStyle = node.color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2)
    if (node.context) { ctx.strokeStyle = node.color; ctx.lineWidth = 1; ctx.stroke() }
    else ctx.fill()
    if (node.iri === props.selectedIri) { ctx.strokeStyle = theme.primary; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, radius + 4, 0, Math.PI * 2); ctx.stroke() }
    if (node === hover || node.iri === props.selectedIri || (props.labels && (view.scale > 1.3 || props.visibleIris.length <= 30))) {
      ctx.font = `11px ${theme.font}`; ctx.fillStyle = theme.text
      ctx.fillText(node.label.length > 42 ? `${node.label.slice(0, 40)}…` : node.label, x + radius + 6, y + 4)
    }
    ctx.globalAlpha = 1
  }
}
function scheduleDraw(): void { if (!disposed && !frame) frame = requestAnimationFrame(draw) }
function fit(): void {
  if (!width || !height) { needsFit = true; return }
  const points = nodes.filter(node => node.visible)
  if (!points.length) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of points) {
    const x = props.mode === 'type' ? node.x : node.nx, y = props.mode === 'type' ? node.y : node.ny
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const scale = Math.max(0.02, Math.min(2, Math.max(1, width - 110) / Math.max(80, maxX - minX), Math.max(1, height - 170) / Math.max(80, maxY - minY)))
  view = { scale, x: width / 2 - (minX + maxX) / 2 * scale, y: height / 2 + 15 - (minY + maxY) / 2 * scale }
  needsFit = false; emit('zoomChange', Math.round(scale * 100)); scheduleDraw()
}
function zoom(factor: number, x = width / 2, y = height / 2): void {
  view = zoomGraphAt(view, factor, x, y)
  emit('zoomChange', Math.round(view.scale * 100)); scheduleDraw()
}
defineExpose({ fit, zoom })
function updateVisibility(): void {
  const allowed = new Set(props.visibleIris)
  const matched = new Set(props.matchedIris ?? props.visibleIris)
  for (const node of nodes) { node.visible = allowed.has(node.iri); node.context = !matched.has(node.iri) }
  visibleEdges = edges.filter(({ a, b }) => a.visible && b.visible)
  hover = undefined; tooltip.value = ''; scheduleDraw()
}
function prepare(): void {
  const byId = new Map<string, Node>()
  nodes = []; groups = []; edges = []
  for (const { data, position: p } of props.elements) {
    if (data.kind === 'subject' && p) {
      const node: Node = { id: data.id!, iri: data.iri, label: data.label, color: data.color, group: data.type, x: p.x, y: p.y, nx: p.x, ny: p.y, visible: true, context: false }
      nodes.push(node); byId.set(node.id, node)
    } else if (data.kind === 'group' && p) groups.push({ label: String(data.label).replace(/ \/ \d+$/, ''), color: data.color, x: p.x, y: p.y, type: data.id!.slice(6) })
  }
  for (const { data } of props.elements) if (data.source && data.target) {
    const a = byId.get(data.source), b = byId.get(data.target)
    if (a && b) edges.push({ a, b })
  }
  layoutReviewNetwork(nodes, edges.map(({ a, b }) => ({ source: a.id, target: b.id }))).forEach((p, i) => { nodes[i].nx = p.x; nodes[i].ny = p.y })
  updateVisibility(); needsFit = true; fit()
}
function resize(): void {
  if (!host.value || !canvas.value) return
  const bounds = host.value.getBoundingClientRect(), oldWidth = width, oldHeight = height
  const styles = getComputedStyle(host.value)
  theme = {
    text: styles.getPropertyValue('--color-text').trim() || theme.text,
    edge: styles.getPropertyValue('--color-text-muted').trim() || theme.edge,
    primary: styles.getPropertyValue('--color-primary').trim() || theme.primary,
    font: styles.fontFamily || theme.font,
  }
  width = bounds.width; height = bounds.height
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  canvas.value.width = Math.round(width * ratio); canvas.value.height = Math.round(height * ratio)
  if (needsFit) fit()
  else view = resizeGraphViewport(view, width - oldWidth, height - oldHeight)
  scheduleDraw()
}
function local(event: { clientX: number; clientY: number }): [number, number] {
  const bounds = canvas.value!.getBoundingClientRect()
  return [event.clientX - bounds.left, event.clientY - bounds.top]
}
function pick(x: number, y: number): Node | undefined {
  let best: Node | undefined, distance = 12
  for (const node of nodes) {
    if (!node.visible) continue
    const p = position(node), d = Math.hypot(x - p[0], y - p[1])
    if (d < distance) { best = node; distance = d }
  }
  return best
}
function wheel(event: WheelEvent): void {
  event.preventDefault()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1)
  zoom(Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.001), ...local(event))
}
function pointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const [x, y] = local(event)
  drag = { id: event.pointerId, x, y, ox: view.x, oy: view.y, moved: false }
  canvas.value!.setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent): void {
  const [x, y] = local(event)
  if (drag) {
    if (event.pointerId !== drag.id) return
    const dx = x - drag.x, dy = y - drag.y
    drag.moved ||= Math.hypot(dx, dy) > 4
    view = { ...view, x: drag.ox + dx, y: drag.oy + dy }; tooltip.value = ''; scheduleDraw(); return
  }
  const next = pick(x, y)
  if (hover !== next) { hover = next; tooltip.value = next?.label ?? ''; scheduleDraw() }
  tooltipPosition.value = { left: `${Math.max(8, Math.min(width - 220, x + 15))}px`, top: `${Math.max(8, Math.min(height - 40, y + 15))}px` }
  canvas.value!.style.cursor = hover ? 'pointer' : 'grab'
}
function pointerUp(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return
  const click = !drag.moved
  drag = undefined
  if (canvas.value!.hasPointerCapture(event.pointerId)) canvas.value!.releasePointerCapture(event.pointerId)
  if (click) {
    const node = pick(...local(event))
    if (node) emit('openSubject', node.iri)
    else emit('deselect')
  }
}
watch(() => props.elements, prepare)
watch(() => [props.visibleIris, props.matchedIris], updateVisibility)
watch(() => [props.mode, props.labels, props.selectedIri], () => { hover = undefined; tooltip.value = ''; scheduleDraw() })
onMounted(() => { prepare(); resize(); observer = new ResizeObserver(resize); observer.observe(host.value!) })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame) })
</script>

<template>
  <div ref="host" class="canvas-shell">
    <canvas
      ref="canvas" aria-label="Interactive subject graph. Drag to pan, scroll to zoom. Use Inspect entity for keyboard access."
      @wheel="wheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
      @pointercancel="drag = undefined" @lostpointercapture="drag = undefined"
      @pointerleave="hover = undefined; tooltip = ''; scheduleDraw()"
    />
    <span v-if="tooltip" class="graph-tooltip" :style="tooltipPosition">{{ tooltip }}</span>
  </div>
</template>

<style scoped>
.canvas-shell { position: relative; min-width: 0; overflow: hidden; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.graph-tooltip { position: absolute; max-width: 210px; padding: 7px 10px; border: 1px solid var(--color-border); border-radius: 5px; background: var(--color-surface); color: var(--color-text); font-size: 12px; pointer-events: none; box-shadow: var(--shadow-sm); }
</style>
