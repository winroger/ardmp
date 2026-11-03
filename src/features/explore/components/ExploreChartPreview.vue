<script setup lang="ts">
import type { ExploreChartPreviewModel } from '@/services/explore/chartPreview'
import ExploreChartCanvas from '@/features/explore/components/ExploreChartCanvas.vue'
import ExploreGeoMapCanvas from '@/features/explore/components/ExploreGeoMapCanvas.vue'

defineEmits<{
  openSubject: [subjectIri: string]
}>()

withDefaults(defineProps<{
  preview: ExploreChartPreviewModel
  height?: number | string
  allowOnlineTiles?: boolean
}>(), {
  height: 320,
  allowOnlineTiles: true,
})
</script>

<template>
  <ExploreChartCanvas v-if="preview.kind === 'echarts'" :option="preview.option" :height="height" />
  <ExploreGeoMapCanvas v-else :preview="preview" :height="height" :allow-online-tiles="allowOnlineTiles" @open-subject="subjectIri => $emit('openSubject', subjectIri)" />
</template>
