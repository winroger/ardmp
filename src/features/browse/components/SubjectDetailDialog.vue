<script setup lang="ts">
// Compatibility wrapper for Analyze; Review embeds the same detail panel directly.
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import type { BrowseModel } from '@/services/browse/browseService'
import type { NodeShape } from '@/domain/NodeShape'
import SubjectDetailPanel from './SubjectDetailPanel.vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  subjectIri: string | null
  model: BrowseModel | null
  shapes: readonly NodeShape[]
  shapesTurtle: string
  valuesTurtle: string
  offline?: boolean
  allowExternalImages?: boolean
}>(), { offline: false, allowExternalImages: true })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const selectedIri = ref(props.subjectIri)
watch(() => [props.subjectIri, props.modelValue], () => { selectedIri.value = props.subjectIri })
</script>

<template>
  <Dialog v-model:visible="visible" modal :show-header="false" :style="{ width: '480px', maxWidth: '95vw' }">
    <SubjectDetailPanel v-if="visible" :subject-iri="selectedIri" :model="model" :shapes="shapes" :shapes-turtle="shapesTurtle" :values-turtle="valuesTurtle" :offline="offline" :allow-external-images="allowExternalImages" @close="visible = false" @open-subject="iri => selectedIri = iri" />
  </Dialog>
</template>
