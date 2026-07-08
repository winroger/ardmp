<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

const props = withDefaults(defineProps<{
  option: EChartsOption | null
  height?: number | string
}>(), {
  height: 320,
})

const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const hostStyle = computed(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
}))

function ensureChart(): void {
  if (!host.value) return
  if (!chart) chart = echarts.init(host.value)
}

function renderChart(): void {
  ensureChart()
  if (!chart) return

  if (!props.option) {
    chart.clear()
    return
  }

  chart.setOption(props.option, true)
  chart.resize()
}

function handleResize(): void {
  chart?.resize()
}

onMounted(() => {
  renderChart()
  window.addEventListener('resize', handleResize)
})

watch(() => props.option, renderChart, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="host" class="explore-chart-canvas" :style="hostStyle" />
</template>

<style scoped lang="scss">
.explore-chart-canvas {
  width: 100%;
  min-height: 220px;
}
</style>