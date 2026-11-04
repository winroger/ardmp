<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { APP_MODES, type AppModeKey } from '@/router'
import { useDataStore } from '@/stores/dataStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useProjectStore } from '@/stores/projectStore'
import { useShapesStore } from '@/stores/shapesStore'
import {
  downloadProjectSnapshot,
  readProjectSnapshotFile,
} from '@/services/project/projectFile'
import { restoreProjectSnapshot } from '@/services/project/projectLifecycle'
import { resetProjectUiState } from '@/services/project/projectUiState'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { ref } from 'vue'

const route = useRoute()
const router = useRouter()
const dataStore = useDataStore()
const metadataStore = useMetadataStore()
const mappingStore = useMappingStore()
const projectStore = useProjectStore()
const shapesStore = useShapesStore()
const toast = useToast()
const confirm = useConfirm()
const projectUploadInputRef = ref<HTMLInputElement | null>(null)
const logoUrl = `${import.meta.env.BASE_URL}ardmp-logo.svg`

const activeMode = computed<AppModeKey>(() => {
  const matchedMode = APP_MODES.find(mode => route.path.startsWith(mode.path))
  return matchedMode?.key ?? 'prepare'
})

const hasWorkspaceContent = computed(() =>
  shapesStore.hasShapes
  || dataStore.sources.length > 0
  || mappingStore.state.hasMappings
  || metadataStore.getCombinedMetadataTurtle().trim().length > 0,
)

function navigate(modeKey: AppModeKey): void {
  const mode = APP_MODES.find(entry => entry.key === modeKey)
  if (!mode || route.path === mode.path) return
  void router.push(mode.path)
}

function downloadProject(): void {
  const filename = downloadProjectSnapshot(projectStore.createSnapshot())
  toast.add({
    severity: 'success',
    summary: 'Project downloaded',
    detail: `Saved as ${filename}.`,
    life: 3000,
  })
}

function triggerProjectUpload(): void {
  projectUploadInputRef.value?.click()
}

async function restoreUploadedProject(file: File): Promise<void> {
  try {
    const snapshot = await readProjectSnapshotFile(file)
    await restoreProjectSnapshot({
      projectStore,
      snapshot,
      toast,
      resetUiState: resetProjectUiState,
      successSummary: 'Project uploaded',
      successDetail: 'The uploaded project replaced the current workspace.',
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Project upload failed',
      detail: error instanceof Error ? error.message : String(error),
      life: 5000,
    })
  }
}

function confirmProjectUpload(file: File): void {
  if (!hasWorkspaceContent.value) {
    void restoreUploadedProject(file)
    return
  }

  confirm.require({
    header: 'Upload project',
    message: 'The current workspace will be replaced by the uploaded project file.',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Upload project',
    rejectLabel: 'Cancel',
    accept: () => {
      void restoreUploadedProject(file)
    },
  })
}

function onProjectFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  confirmProjectUpload(file)
}
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <div class="app-shell__brand">
        <img :src="logoUrl" class="app-shell__brand-logo" alt="ARDMP" width="156" height="44">
      </div>

      <nav class="app-shell__nav" aria-label="Application sections">
        <Button
          v-for="mode in APP_MODES"
          :key="mode.key"
          :label="mode.label"
          :icon="mode.icon"
          :severity="activeMode === mode.key ? undefined : 'secondary'"
          :outlined="activeMode !== mode.key"
          :aria-current="activeMode === mode.key ? 'page' : undefined"
          size="small"
          @click="navigate(mode.key)"
        />
      </nav>

      <div class="app-shell__actions">
        <Button
          label="Upload Project"
          icon="pi pi-upload"
          severity="secondary"
          outlined
          size="small"
          @click="triggerProjectUpload"
        />
        <Button
          label="Download Project"
          icon="pi pi-download"
          size="small"
          @click="downloadProject"
        />
        <input
          ref="projectUploadInputRef"
          type="file"
          accept=".json,.ardmp.json,application/json"
          style="display:none"
          @change="onProjectFileChange"
        >
      </div>
    </header>

    <main class="app-shell__content">
      <slot />
    </main>
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  color: var(--color-text);
}

.app-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-logo-panel);
}

.app-shell__brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.app-shell__brand-logo {
  display: block;
  width: 156px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.app-shell__nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.app-shell__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}

.app-shell__content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 900px) {
  .app-shell__header {
    flex-direction: column;
    align-items: stretch;
  }

  .app-shell__nav {
    justify-content: flex-start;
  }

  .app-shell__actions {
    justify-content: flex-start;
  }
}
</style>
