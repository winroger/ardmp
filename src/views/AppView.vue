<script setup lang="ts">
/**
 * AppView — unified main view that merges Setup + Mapping + Export.
 *
 * Components are added via the Menubar (top): source data, target schema,
 * enrichment, transformation, and reset. The canvas itself
 * stays minimal — no legend, no help asides, no info banners.
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { useDataStore } from '@/stores/dataStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useShapesStore } from '@/stores/shapesStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useProjectStore } from '@/stores/projectStore'
import { useMappingValidation } from '@/features/mapping/useMappingValidation'
import { useCanvasGraph } from '@/features/mapping/useCanvasGraph'
import { useCanvasConnections } from '@/features/mapping/useCanvasConnections'
import { useCanvasSetupMenu } from '@/features/mapping/useCanvasSetupMenu'
import { useCanvasPreviews } from '@/features/mapping/useCanvasPreviews'
import CanvasDialogs from '@/features/mapping/components/CanvasDialogs.vue'
import MappingValidationSidebar from '@/features/mapping/components/MappingValidationSidebar.vue'
import Menubar from 'primevue/menubar'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

const data = useDataStore()
const metadata = useMetadataStore()
const shapes = useShapesStore()
const mapping = useMappingStore()
const project = useProjectStore()
const toast = useToast()
const confirm = useConfirm()
const { sources } = storeToRefs(data)
const { nodeShapes, profiles, isResolvingImports } = storeToRefs(shapes)
const { canvasShapes } = storeToRefs(shapes)

const {
  tablePreviewOpen,
  pairedSourcePreviewOpen,
  shapePreviewOpen,
  previewSource,
  previewPrimarySource,
  previewSecondarySource,
  previewShape,
  previewShapeValuesTurtle,
  previewShapeSubjects,
  isShapePreviewLoading,
  combinedCanvasShapesTurtle,
  openTablePreview,
  openNodePreview,
  openShapePreview,
} = useCanvasPreviews({
  dataStore: data,
  shapesStore: shapes,
  mappingStore: mapping,
  sources,
  nodeShapes,
  profiles,
  toast,
})

function resetCanvasUiState(): void {
  closeSetupDialog()
  tablePreviewOpen.value = false
  pairedSourcePreviewOpen.value = false
  shapePreviewOpen.value = false
  validationSidebarOpen.value = false
}

// ---------- SHACL validation ----------
const {
  validationSidebarOpen,
  validationResult,
  validationError,
  isValidating,
  canValidate,
  validationStatusSeverity,
  validationStatusIcon,
  validationStatusLabel,
} = useMappingValidation({
  applicationProfile: shapes.ap,
  profiles,
  mappingState: mapping.state,
  sources,
  getCombinedMetadataTurtle: () => metadata.getCombinedMetadataTurtle(),
})

const {
  schemaInputRef,
  activeSetupDialogDefinition,
  activeSetupDialogVisible,
  activeSetupDialogKey,
  activeSetupDialogProps,
  menuItems,
  onSchemaFiles,
  closeSetupDialog,
  openSetupDialog,
} = useCanvasSetupMenu({
  dataStore: data,
  metadataStore: metadata,
  shapesStore: shapes,
  mappingStore: mapping,
  projectStore: project,
  toast,
  confirm,
  resetUiState: resetCanvasUiState,
})

const { nodes, edges, nodeTypes } = useCanvasGraph({
  dataStore: data,
  mappingStore: mapping,
  sources,
  canvasShapes,
  toast,
  openSetupDialog,
  openTablePreview,
  openNodePreview,
  openShapePreview,
})

useCanvasConnections({
  dataStore: data,
  mappingStore: mapping,
  sources,
  toast,
  confirm,
})

const hasNothing = computed(() =>
  profiles.value.length === 0
  && sources.value.length === 0,
)
</script>

<template>
  <div class="app-view">
    <!-- Top toolbar / menu -->
    <div class="toolbar">
      <Menubar :model="menuItems" />
      <span v-if="isResolvingImports" class="toolbar-status">
        <i class="pi pi-spin pi-spinner" /> Resolving imports...
      </span>
    </div>

    <!-- Hidden file inputs -->
    <input ref="schemaInputRef" type="file" accept=".ttl,.shacl,text/turtle" multiple style="display:none" @change="onSchemaFiles" />

    <!-- Canvas -->
    <div class="canvas-wrapper">
      <div v-if="hasNothing" class="empty-state">
        <i class="pi pi-plus-circle" />
        <h2>Add components</h2>
        <p>Use the top menu to add <strong>Source Data</strong>, <strong>Target Schema</strong>, <strong>Enrichment</strong>, and <strong>Transformation</strong>, or open <strong>Options</strong> to load the built-in example.</p>
      </div>
      <VueFlow
        v-else
        class="mapping-canvas"
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :default-edge-options="{ animated: false, type: 'default' }"
        fit-view-on-init
      >
        <Background pattern-color="var(--color-border)" :gap="20" />
        <Controls position="top-left" />
        <MiniMap pannable zoomable />
      </VueFlow>

      <MappingValidationSidebar
        :open="validationSidebarOpen"
        :result="validationResult"
        :error="validationError"
        :is-validating="isValidating"
        :can-validate="canValidate"
        :status-severity="validationStatusSeverity"
        :status-icon="validationStatusIcon"
        :status-label="validationStatusLabel"
        @close="validationSidebarOpen = false"
        @open="validationSidebarOpen = true"
      />
    </div>

    <CanvasDialogs
      :active-setup-dialog-definition="activeSetupDialogDefinition"
      :active-setup-dialog-visible="activeSetupDialogVisible"
      :active-setup-dialog-key="activeSetupDialogKey"
      :active-setup-dialog-props="activeSetupDialogProps"
      :table-preview-open="tablePreviewOpen"
      :paired-source-preview-open="pairedSourcePreviewOpen"
      :shape-preview-open="shapePreviewOpen"
      :preview-source="previewSource"
      :preview-primary-source="previewPrimarySource"
      :preview-secondary-source="previewSecondarySource"
      :preview-shape="previewShape"
      :combined-canvas-shapes-turtle="combinedCanvasShapesTurtle"
      :preview-shape-values-turtle="previewShapeValuesTurtle"
      :preview-shape-subjects="previewShapeSubjects"
      :is-shape-preview-loading="isShapePreviewLoading"
      @close-setup-dialog="closeSetupDialog"
      @update:active-setup-dialog-visible="activeSetupDialogVisible = $event"
      @update:table-preview-open="tablePreviewOpen = $event"
      @update:paired-source-preview-open="pairedSourcePreviewOpen = $event"
      @update:shape-preview-open="shapePreviewOpen = $event"
    />
  </div>
</template>

<style scoped lang="scss">
.app-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-border);
  :deep(.p-menubar) { background: transparent; border: 0; padding: 0; }
}
.toolbar-status {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  margin-left: auto;
}

.canvas-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.mapping-canvas {
  width: 100%;
  height: 100%;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  text-align: center;
  padding: var(--space-5);
  .pi-plus-circle { font-size: 3rem; color: var(--color-accent); }
  h2 { margin: 0; font-size: 1.25rem; color: var(--color-text); }
  p { margin: 0; max-width: 480px; line-height: 1.55; }
}

</style>


