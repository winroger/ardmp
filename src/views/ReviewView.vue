<script setup lang="ts">
/**
 * BrowseView — list and Turtle view over generated RDF subjects.
 *
 * On mount: regenerates RDF automatically from the current mapping.
 *
 * Cross-references between subjects are rendered with the referenced
 * subject's resolved label (resolvedLabel from browseService) instead
 * of raw IRIs, so a card that points to "recF60FgOJh6JERc" actually
 * shows "Bosch Capdeferro Architecture".
 *
 * The list view pivots properties into table columns: each unique
 * predicate within the currently visible subject set becomes a column
 * whose header shows the human label on top and the property path underneath.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { Store } from 'rdflib'
import { isCanvasVisibleDataSource } from '@/domain/DataSource'
import type { NodeShape } from '@/domain/NodeShape'
import { useShapesStore } from '@/stores/shapesStore'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { generateRdf, serializeGraph } from '@/services/rdf/rdfGenerator'
import { buildBrowseModel, type BrowseModel } from '@/services/browse/browseService'
import { buildRuntimeStagingShapes, type RuntimeStagingShapes } from '@/services/mapping/stagingShapes'
import DatasetReview from '@/features/browse/components/DatasetReview.vue'

const shapesStore = useShapesStore()
const dataStore = useDataStore()
const mappingStore = useMappingStore()
const { ap, hasShapes, nodeShapes, profiles } = storeToRefs(shapesStore)
const { sources } = storeToRefs(dataStore)

/**
 * Combined raw Turtle of every loaded data-shape profile. Passed to the
 * `<shacl-form>` web component as `data-shapes` for the detail dialog.
 */
const combinedShapesTurtle = computed(() =>
  profiles.value.map(p => p.rawTurtle).join('\n\n'),
)

function createEmptyRuntimeStagingShapes(): RuntimeStagingShapes {
  return {
    profile: null,
    nodeShapes: [],
    turtle: '',
  }
}

const runtimeStagingShapes = ref<RuntimeStagingShapes>(createEmptyRuntimeStagingShapes())

const browseNodeShapes = computed<readonly NodeShape[]>(() => [
  ...nodeShapes.value,
  ...runtimeStagingShapes.value.nodeShapes,
])

const browseShapesTurtle = computed(() =>
  [combinedShapesTurtle.value, runtimeStagingShapes.value.turtle].filter(Boolean).join('\n\n'),
)

const canBrowse = computed(() =>
  sources.value.some(source => isCanvasVisibleDataSource(source))
  || (hasShapes.value && sources.value.length > 0 && mappingStore.state.hasMappings),
)

// ---------- RDF + validation, auto-built from current state ----------
const model = ref<BrowseModel | null>(null)
const generatedStore = shallowRef<Store | null>(null)
const ttlOutput = ref('')
const generationError = ref<string | null>(null)
const isGenerating = ref(false)

async function regenerate(): Promise<void> {
  if (!canBrowse.value) {
    runtimeStagingShapes.value = createEmptyRuntimeStagingShapes()
    model.value = null
    generatedStore.value = null
    ttlOutput.value = ''
    generationError.value = null
    return
  }
  isGenerating.value = true
  generationError.value = null
  try {
    const nextRuntimeStagingShapes = buildRuntimeStagingShapes(
      sources.value,
      mappingStore.state,
      nodeShapes.value,
    )
    runtimeStagingShapes.value = nextRuntimeStagingShapes

    const result = generateRdf(ap.value, mappingStore.state, sources.value)
    generatedStore.value = result.store
    model.value = buildBrowseModel(
      result.store,
      [...nodeShapes.value, ...nextRuntimeStagingShapes.nodeShapes],
      sources.value,
    )
    ttlOutput.value = await serializeGraph(result.store, 'text/turtle')
  } catch (err) {
    generationError.value = err instanceof Error ? err.message : String(err)
    runtimeStagingShapes.value = createEmptyRuntimeStagingShapes()
    model.value = null
    generatedStore.value = null
    ttlOutput.value = ''
  } finally {
    isGenerating.value = false
  }
}

onMounted(regenerate)
// Re-run if the underlying data changes while the view is mounted.
watch(
  [
    () => sources.value.length,
    () => sources.value.map(s => s.id).join('|'),
    () => nodeShapes.value.length,
    () => mappingStore.state.edges.length,
    () => JSON.stringify(mappingStore.state.subjectIdentifiers),
    () => JSON.stringify(mappingStore.state.stagingColumns.inactiveColumnsBySource),
  ],
  regenerate,
)

</script>

<template>
  <DatasetReview
    :model="model"
    :generated-store="generatedStore"
    :browse-node-shapes="browseNodeShapes"
    :browse-shapes-turtle="browseShapesTurtle"
    :ttl-output="ttlOutput"
    :can-browse="canBrowse"
    :generation-error="generationError"
  />
</template>
