<script setup lang="ts">
import { computed, ref } from 'vue'
import '@ulb-darmstadt/shacl-form'
import { LeafletPlugin } from '@ulb-darmstadt/shacl-form/plugins/leaflet.js'
import type { BrowseModel } from '@/services/browse/browseService'
import type { NodeShape } from '@/domain/NodeShape'
import { localName, thumbnailUrlForSubject } from '../browseViewHelpers'
import { useShaclFormViewer, type ShaclFormElement } from '@/features/shacl/useShaclFormViewer'

const props = withDefaults(defineProps<{
  subjectIri: string | null
  model: BrowseModel | null
  shapes: readonly NodeShape[]
  shapesTurtle: string
  valuesTurtle: string
  offline?: boolean
  allowExternalImages?: boolean
}>(), { offline: false, allowExternalImages: true })
const emit = defineEmits<{ close: []; openSubject: [iri: string] }>()
const subjectsByIri = computed(() => new Map(props.model?.groups.flatMap(group => group.subjects.map(subject => [subject.iri, subject] as const)) ?? []))
const subject = computed(() => subjectsByIri.value.get(props.subjectIri ?? '') ?? null)
const classLabels = computed(() => new Map(props.model?.groups.map(group => [group.classIri, group.classLabel]) ?? []))
const thumbnailUrl = computed(() => subject.value && props.allowExternalImages ? thumbnailUrlForSubject(subject.value) : undefined)
const matchingShape = computed(() => {
  if (!subject.value) return null
  const predicates = new Set(subject.value.properties.map(property => property.predicate))
  return props.shapes.filter(shape => subject.value!.classes.includes(shape.targetClass?.value ?? ''))
    .map(shape => ({ shape, coverage: shape.properties.filter(property => property.path && predicates.has(property.path.value)).length }))
    .sort((a, b) => b.coverage - a.coverage || b.shape.properties.length - a.shape.properties.length)[0]?.shape ?? null
})
const formRef = ref<ShaclFormElement | null>(null)
const preparedForms = new WeakSet<HTMLElement>()
useShaclFormViewer({
  formRef,
  watchSources: [subject, matchingShape, () => props.shapesTurtle, () => props.valuesTurtle],
  getShapesTurtle: () => props.shapesTurtle,
  getValuesTurtle: () => props.valuesTurtle,
  getValuesSubject: () => subject.value?.iri,
  getShapeSubject: () => matchingShape.value?.nodeId.termType === 'NamedNode' ? matchingShape.value.nodeId.value : undefined,
  getExtraAttributes: () => ({ 'data-ignore-owl-imports': 'true' }),
  shouldApply: () => Boolean(subject.value && matchingShape.value),
  prepareElement: element => {
    if (!props.offline && !preparedForms.has(element)) {
      element.registerPlugin?.(new LeafletPlugin({ datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral' }))
      preparedForms.add(element)
    }
  },
})

function followInternalLink(event: MouseEvent): void {
  const anchor = event.composedPath().find(target => target instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined
  const iri = anchor?.getAttribute('href')
  if (iri && subjectsByIri.value.has(iri)) { event.preventDefault(); emit('openSubject', iri) }
}
</script>

<template>
  <aside class="subject-detail-panel" aria-label="Entity details">
    <header class="detail-panel-header">
      <div><p class="detail-panel-eyebrow">Entity details</p><h2>{{ subject?.label ?? 'Entity not found' }}</h2></div>
      <button type="button" class="detail-close" aria-label="Close entity details" @click="emit('close')"><i class="pi pi-times" aria-hidden="true" /></button>
    </header>
    <div v-if="subject" :key="subject.iri" class="detail-panel-body">
      <div class="detail-class-list">
        <span v-for="type in subject.classes" :key="type" class="detail-class" :title="type">{{ classLabels.get(type) ?? localName(type) }}</span>
      </div>
      <p class="detail-iri mono-meta">{{ subject.iri }}</p>
      <img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="`Thumbnail for ${subject.label}`" class="subject-preview-image" loading="lazy">
      <shacl-form
        v-if="matchingShape"
        ref="formRef"
        data-view
        data-collapse="open"
        data-ignore-owl-imports
        data-language="en"
        data-show-root-shape-label="false"
        @click="followInternalLink"
      />
      <dl v-else class="detail-properties">
        <div v-for="(property, index) in subject.properties" :key="index">
          <dt :title="property.predicate">{{ property.label }}</dt>
          <dd>
            <button v-if="property.isResource && subjectsByIri.has(property.value)" type="button" class="link-button" @click="emit('openSubject', property.value)">{{ subjectsByIri.get(property.value)?.label }}</button>
            <a v-else-if="property.isResource && /^https?:/.test(property.value)" :href="property.value" target="_blank" rel="noopener noreferrer">{{ property.resolvedLabel ?? property.value }}</a>
            <span v-else>{{ property.value }}</span>
          </dd>
        </div>
      </dl>
      <p v-if="!matchingShape && !subject.properties.length" class="detail-empty">No properties are available for this entity.</p>
    </div>
    <p v-else class="detail-empty">This entity is no longer part of the current dataset.</p>
  </aside>
</template>

<style scoped lang="scss">
.subject-detail-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
.detail-panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); border-bottom: 1px solid var(--color-border); }
.detail-panel-header > div { min-width: 0; }
.detail-panel-eyebrow { margin: 0 0 var(--space-1); color: var(--color-text-muted); font-size: 0.75rem; }
h2 { margin: 0; font-size: 1rem; line-height: 1.4; overflow-wrap: anywhere; }
.detail-close { flex-shrink: 0; display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text-muted); cursor: pointer; }
.detail-close:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.detail-panel-body { min-height: 0; overflow: auto; padding: var(--space-4); }
.detail-class-list { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.detail-class { padding: var(--space-1) var(--space-2); background: var(--color-accent-soft); border-radius: var(--radius-sm); font-size: 0.75rem; color: var(--color-text); }
.detail-iri { margin: var(--space-2) 0 var(--space-4); overflow-wrap: anywhere; font-size: 0.7rem; }
.subject-preview-image { display: block; width: 100%; max-height: 200px; object-fit: contain; margin-bottom: var(--space-4); border-radius: var(--radius-sm); }
shacl-form { display: block; min-width: 0; --shacl-font-family: var(--font-sans); --shacl-border-color: var(--color-border); }
.detail-properties { margin: 0; }
.detail-properties > div { padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
dt { color: var(--color-text-muted); font-size: 0.75rem; margin-bottom: var(--space-1); }
dd { margin: 0; overflow-wrap: anywhere; font-size: 0.875rem; }
.detail-empty { padding: var(--space-4); color: var(--color-text-muted); font-size: 0.875rem; }
</style>
