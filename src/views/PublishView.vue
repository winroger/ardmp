<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import '@ulb-darmstadt/shacl-form'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useDataStore } from '@/stores/dataStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useProjectStore } from '@/stores/projectStore'
import { useExploreStore } from '@/stores/exploreStore'
import { downloadBlob } from '@/services/export/exportService'
import { useDatasetMetadataWorkflow } from '@/features/export/useDatasetMetadataWorkflow'
import { useShaclFormViewer, type ShaclFormElement } from '@/features/shacl/useShaclFormViewer'
import { applyApplicationShaclTheme } from '@/features/shacl/applicationShaclTheme'
import { useShapesStore } from '@/stores/shapesStore'
import { createPipelineState } from '@/services/pipeline/createPipelineState'
import { buildRoCrateFromPipelineState } from '@/services/pipeline/buildRoCrateFromPipelineState'
import { isCanvasVisibleDataSource } from '@/domain/DataSource'

type SerializableShaclFormElement = ShaclFormElement & {
  serialize?: (format?: string) => string
}

const METADATA_VALUES_NAMESPACE = 'urn:ardmp:metadata:'

const toast = useToast()
const shapesStore = useShapesStore()
const dataStore = useDataStore()
const metadataStore = useMetadataStore()
const mappingStore = useMappingStore()
const projectStore = useProjectStore()
const exploreStore = useExploreStore()

const { sources } = storeToRefs(dataStore)
const { rootProfiles, combinedTurtle, isResolvingImports } = storeToRefs(metadataStore)

const viewerRef = ref<SerializableShaclFormElement | null>(null)
const editorRef = ref<SerializableShaclFormElement | null>(null)
const loadError = ref<string | null>(null)
const isExporting = ref(false)
const {
  loadError: metadataLoadError,
  isEditing,
  draftMetadataTurtle,
  datasetProfile,
  datasetShapeSubject,
  viewerFormKey,
  editorFormKey,
  metadataTurtle,
  metadataValuesSubject,
  draftValuesSubject,
  metadataSummary,
  ensureRokitDatasetProfile,
  startEditing,
  cancelEditing,
  updateDraftFromSerialized,
  saveMetadata: commitMetadata,
} = useDatasetMetadataWorkflow({
  metadataStore,
  projectStore,
  rootProfiles,
  combinedTurtle,
})

const canExport = computed(() =>
  sources.value.some(source => isCanvasVisibleDataSource(source))
  || (shapesStore.hasShapes && sources.value.length > 0 && mappingStore.state.hasMappings),
)

function onEditorChange(): void {
  updateDraftFromSerialized(serializeEditor)
}

function saveMetadata(): void {
  updateDraftFromSerialized(serializeEditor)
  commitMetadata(serializeEditor)
}

function serializeEditor(): string {
  return editorRef.value?.serialize?.('text/turtle') ?? ''
}

async function exportCrate(): Promise<void> {
  if (!canExport.value) return

  isExporting.value = true
  try {
    const pipelineState = createPipelineState({
      projectTitle: metadataSummary.value.name ?? projectStore.project.title,
      ap: shapesStore.ap,
      profiles: shapesStore.profiles,
      sources: sources.value,
      mappingEdges: mappingStore.state.edges,
      subjectIdentifiers: mappingStore.state.subjectIdentifiers,
      stagingColumns: mappingStore.state.stagingColumns,
      explore: exploreStore.createSnapshot(),
      metadataTurtle: metadataStore.getCombinedMetadataTurtle(),
    })
    const result = await buildRoCrateFromPipelineState(pipelineState)
    downloadBlob(result.blob, result.filename)
    toast.add({
      severity: 'success',
      summary: 'RO-Crate exported',
      detail: `${result.filename} (${result.subjectCount} subjects, ${result.tripleCount} triples)`,
      life: 5000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Export failed',
      detail: error instanceof Error ? error.message : String(error),
      life: 5000,
    })
  } finally {
    isExporting.value = false
  }
}

onMounted(() => { void ensureRokitDatasetProfile() })

watch(metadataLoadError, value => {
  loadError.value = value
}, { immediate: true })

useShaclFormViewer({
  formRef: viewerRef,
  prepareElement: applyApplicationShaclTheme,
  watchSources: [viewerFormKey],
  getShapesTurtle: () => combinedTurtle.value,
  getValuesTurtle: () => metadataTurtle.value,
  getValuesSubject: () => metadataValuesSubject.value,
  getShapeSubject: () => datasetShapeSubject.value,
  getExtraAttributes: () => ({
    'data-values-namespace': METADATA_VALUES_NAMESPACE,
  }),
  shouldApply: () => !isEditing.value,
  deferApply: apply => { void nextTick().then(apply) },
})

useShaclFormViewer({
  formRef: editorRef,
  prepareElement: applyApplicationShaclTheme,
  watchSources: [editorFormKey, isEditing],
  getShapesTurtle: () => combinedTurtle.value,
  getValuesTurtle: () => draftMetadataTurtle.value,
  getValuesSubject: () => draftValuesSubject.value,
  getShapeSubject: () => datasetShapeSubject.value,
  getExtraAttributes: () => ({
    'data-values-namespace': METADATA_VALUES_NAMESPACE,
  }),
  shouldApply: () => isEditing.value,
  deferApply: apply => { void nextTick().then(apply) },
})
</script>

<template>
  <div class="export-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Publish</h1>
        <p class="page-subtitle">Maintain the RO-Crate metadata through the RO-kit dataset profile and then publish the package.</p>
      </div>
      <Button
        icon="pi pi-download"
        label="Download RO-Crate"
        :disabled="!canExport || Boolean(loadError)"
        :loading="isExporting"
        @click="exportCrate"
      />
    </header>

    <Message v-if="!canExport" severity="warn" :closable="false">
      Load source data to publish a package with generic staging RDF and RML. Target schema and explicit mappings remain optional.
    </Message>
    <Message v-if="loadError" severity="error" :closable="false">
      {{ loadError }}
    </Message>

    <div class="export-layout">
      <section class="metadata-section">
        <header class="section-header">
          <div>
            <h2 class="section-title">RO-kit Dataset</h2>
            <p class="helper-text">Saved metadata is shown in the viewer. Edit it explicitly and apply changes by saving.</p>
          </div>
          <div class="section-actions">
            <Tag value="RO-kit dataset" severity="warn" />
            <Button
              v-if="!isEditing"
              icon="pi pi-pencil"
              label="Edit"
              severity="secondary"
              @click="startEditing"
            />
            <template v-else>
              <Button
                icon="pi pi-times"
                label="Cancel"
                severity="secondary"
                outlined
                @click="cancelEditing"
              />
              <Button
                icon="pi pi-check"
                label="Save"
                @click="saveMetadata"
              />
            </template>
          </div>
        </header>

        <div v-if="isResolvingImports" class="inline-status inline-meta">
          <i class="pi pi-spin pi-spinner" />
          <span>Resolving imports...</span>
        </div>

        <Message v-if="!datasetProfile" severity="info" :closable="false">
          The RO-kit dataset profile is loading.
        </Message>

        <template v-else>
          <Message v-if="!metadataTurtle && !isEditing" severity="info" :closable="false">
            No metadata saved yet. Start editing to capture the publish metadata.
          </Message>

          <shacl-form
            v-if="!isEditing"
            :key="viewerFormKey"
            ref="viewerRef"
            class="metadata-form"
            data-view
            data-collapse="open"
            data-ignore-owl-imports
            data-language="en"
          />

          <div v-else class="editor-shell">
            <Message severity="warn" :closable="false">
              Changes are only applied to publish and tab switches after saving.
            </Message>
            <shacl-form
              :key="editorFormKey"
              ref="editorRef"
              class="metadata-form"
              data-collapse="open"
              data-ignore-owl-imports
              data-language="en"
              @change="onEditorChange"
            />
          </div>
        </template>
      </section>

    </div>
  </div>
</template>

<style scoped lang="scss">
.export-view {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.export-layout {
  display: block;
}

.metadata-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.section-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

.editor-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.metadata-form {
  display: block;
  min-height: 420px;
  max-height: calc(100vh - 280px);
  overflow: auto;
}

@media (max-width: 1080px) {
  .metadata-form {
    max-height: none;
  }
}
</style>


