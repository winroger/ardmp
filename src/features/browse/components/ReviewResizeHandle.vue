<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ label: string; value: number; min: number; max: number; reverse?: boolean; defaultValue: number }>()
const emit = defineEmits<{ 'update:value': [width: number] }>()
const dragging = ref(false)
let startX = 0, startWidth = 0, pointerId: number | undefined
function update(width: number): void { emit('update:value', Math.round(Math.max(props.min, Math.min(props.max, width)))) }
function start(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  startX = event.clientX; startWidth = props.value; pointerId = event.pointerId
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragging.value = true
}
function move(event: PointerEvent): void {
  if (dragging.value && event.pointerId === pointerId) update(startWidth + (event.clientX - startX) * (props.reverse ? -1 : 1))
}
function stop(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  pointerId = undefined
}
function keyboard(event: KeyboardEvent): void {
  const step = event.shiftKey ? 40 : 10
  const direction = props.reverse ? -1 : 1
  if (event.key === 'ArrowLeft') update(props.value - step * direction)
  else if (event.key === 'ArrowRight') update(props.value + step * direction)
  else if (event.key === 'Home') update(props.min)
  else if (event.key === 'End') update(props.max)
  else return
  event.preventDefault()
}
</script>

<template>
  <div
    class="review-resize-handle" :class="{ 'is-dragging': dragging }" role="separator" tabindex="0"
    aria-orientation="vertical" :aria-label="label" :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="value"
    :aria-valuetext="`${value} pixels`" title="Drag to resize. Double-click to reset. Arrow keys also resize."
    @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="dragging = false"
    @keydown="keyboard" @dblclick="update(defaultValue)"
  />
</template>

<style scoped>
.review-resize-handle { position: relative; cursor: col-resize; touch-action: none; user-select: none; outline: none; min-height: 40px; }
.review-resize-handle::after { content: ''; position: absolute; width: 3px; top: 12px; bottom: 12px; left: calc(50% - 1.5px); border-radius: 2px; background: var(--color-border); transition: background 0.15s; }
.review-resize-handle:hover::after, .review-resize-handle:focus-visible::after, .review-resize-handle.is-dragging::after { background: var(--color-primary); }
</style>
