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
import { downloadBlob } from '@/services/export/exportService'
import { useDatasetMetadataWorkflow } from '@/features/export/useDatasetMetadataWorkflow'
import { useShaclFormViewer, type ShaclFormElement } from '@/features/shacl/useShaclFormViewer'
import { useShapesStore } from '@/stores/shapesStore'
import { createPipelineState } from '@/services/pipeline/createPipelineState'
import { buildRoCrateFromPipelineState } from '@/services/pipeline/buildRoCrateFromPipelineState'

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
  rootProfiles,
  combinedTurtle,
})

const canExport = computed(() =>
  shapesStore.hasShapes
  && sources.value.length > 0
  && mappingStore.state.hasMappings,
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
      metadataTurtle: metadataStore.getCombinedMetadataTurtle(),
    })
    const result = await buildRoCrateFromPipelineState(pipelineState)
    downloadBlob(result.blob, result.filename)
    toast.add({
      severity: 'success',
      summary: 'RO-Crate exportiert',
      detail: `${result.filename} (${result.subjectCount} Subjekte, ${result.tripleCount} Triples)`,
      life: 5000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Export fehlgeschlagen',
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
    <header class="view-header">
      <div>
        <h1>Export</h1>
        <p class="subtitle">Pflege die RO-Crate-Metadaten ueber das RO-kit-Datensatzprofil und exportiere anschliessend das Paket.</p>
      </div>
      <Button
        icon="pi pi-download"
        label="Export RO-Crate"
        :disabled="!canExport || Boolean(loadError)"
        :loading="isExporting"
        @click="exportCrate"
      />
    </header>

    <Message v-if="!canExport" severity="warn" :closable="false">
      Lade Target Schema, Source Data und mindestens ein Mapping, bevor du exportierst.
    </Message>
    <Message v-if="loadError" severity="error" :closable="false">
      {{ loadError }}
    </Message>

    <div class="export-layout">
      <section class="metadata-section">
        <header class="section-header">
          <div>
            <h2>RO-kit Datensatz</h2>
            <p>Gespeicherte Metadaten werden im Viewer angezeigt. Bearbeite sie explizit und uebernimm die Aenderungen mit Speichern.</p>
          </div>
          <div class="section-actions">
            <Tag value="RO-kit dataset" severity="warn" />
            <Button
              v-if="!isEditing"
              icon="pi pi-pencil"
              label="Bearbeiten"
              severity="secondary"
              @click="startEditing"
            />
            <template v-else>
              <Button
                icon="pi pi-times"
                label="Abbrechen"
                severity="secondary"
                outlined
                @click="cancelEditing"
              />
              <Button
                icon="pi pi-check"
                label="Speichern"
                @click="saveMetadata"
              />
            </template>
          </div>
        </header>

        <div v-if="isResolvingImports" class="inline-status">
          <i class="pi pi-spin pi-spinner" />
          <span>Importe werden aufgeloest...</span>
        </div>

        <Message v-if="!datasetProfile" severity="info" :closable="false">
          Das RO-kit-Datensatzprofil wird geladen.
        </Message>

        <template v-else>
          <Message v-if="!metadataTurtle && !isEditing" severity="info" :closable="false">
            Noch keine Metadaten gespeichert. Starte ueber Bearbeiten die Erfassung fuer den Export.
          </Message>

          <shacl-form
            v-if="!isEditing"
            :key="viewerFormKey"
            ref="viewerRef"
            class="metadata-form"
            data-view
            data-collapse="open"
            data-ignore-owl-imports
            data-language="de"
            data-show-root-shape-label="false"
          />

          <div v-else class="editor-shell">
            <Message severity="warn" :closable="false">
              Aenderungen werden erst nach Speichern fuer Export und Tab-Wechsel uebernommen.
            </Message>
            <shacl-form
              :key="editorFormKey"
              ref="editorRef"
              class="metadata-form"
              data-collapse="open"
              data-ignore-owl-imports
              data-language="de"
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

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);

  h1 { margin: 0 0 var(--space-1); font-size: 1.75rem; }
}

.subtitle {
  margin: 0;
  color: var(--color-text-muted);
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

  h2,
  p { margin: 0; }

  h2 { font-size: 1.1rem; }
  p {
    margin-top: 4px;
    font-size: 0.85rem;
    color: var(--color-text-muted);
    line-height: 1.5;
  }
}

.section-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

.inline-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: 0.85rem;
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


