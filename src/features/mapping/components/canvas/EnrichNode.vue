<script setup lang="ts">
import Button from 'primevue/button'
import Message from 'primevue/message'
import Select from 'primevue/select'
import { Handle, Position } from '@vue-flow/core'
import { CANVAS_NODE_COLORS } from '@/features/mapping/canvasTheme'
import EnrichmentLookupWarnings from '@/features/mapping/components/EnrichmentLookupWarnings.vue'

type EnrichNodeOutput = {
  id: string
  label: string
}

const props = defineProps<{
  data: {
    title: string
    subtitle: string
    icon: string
    inputHandleId: string
    inputLabel: string
    inputs?: EnrichNodeOutput[]
    inputMode?: string
    inputModeOptions?: Array<{ id: string; label: string }>
    onInputModeChange?: (value: string) => void
    status: 'idle' | 'running' | 'success' | 'error'
    processedCount: number
    totalCount: number
    cachedCount: number
    outputs: EnrichNodeOutput[]
    actionLabel: string
    footerNote: string
    lastError?: string
    lookupErrors?: Array<{ input: string; message: string }>
    theme?: {
      headerBackground?: string
      headerColor?: string
      headerSubtleColor?: string
      previewBorderColor?: string
      inputHandleColor?: string
      outputHandleColor?: string
    }
    onOpenConfig?: () => void
    onPreview?: () => void
    onDelete?: () => void
    onRun?: () => Promise<void> | void
  }
}>()

async function runNode(): Promise<void> {
  await props.data.onRun?.()
}

function openConfig(): void {
  props.data.onOpenConfig?.()
}

function previewNode(): void {
  props.data.onPreview?.()
}

function deleteNode(): void {
  props.data.onDelete?.()
}
</script>

<template>
  <div
    class="enrich-node"
    :style="{
      '--enrich-header-bg': data.theme?.headerBackground ?? CANVAS_NODE_COLORS.enricher.headerBackground,
      '--enrich-header-color': data.theme?.headerColor ?? CANVAS_NODE_COLORS.enricher.headerColor,
      '--enrich-header-subtle': data.theme?.headerSubtleColor ?? CANVAS_NODE_COLORS.enricher.subtleColor,
      '--enrich-preview-border': data.theme?.previewBorderColor ?? CANVAS_NODE_COLORS.enricher.previewBorderColor,
      '--enrich-input-handle': data.theme?.inputHandleColor ?? CANVAS_NODE_COLORS.enricher.inputHandleColor,
      '--enrich-output-handle': data.theme?.outputHandleColor ?? CANVAS_NODE_COLORS.enricher.outputHandleColor,
    }"
    @click="openConfig"
  >
    <header>
      <Handle
        v-if="!data.inputs?.length"
        :id="data.inputHandleId"
        type="target"
        :position="Position.Left"
        class="handle handle-input"
      />
      <i :class="data.icon" />
      <div>
        <strong>{{ data.title }}</strong>
        <span>{{ data.subtitle }}</span>
      </div>
      <div class="header-actions">
        <button class="preview-btn delete-btn icon-pill-button icon-pill-button--danger" type="button" title="Delete node" aria-label="Delete node" @click.stop="deleteNode">
          <i class="pi pi-trash" />
        </button>
        <button class="preview-btn icon-pill-button" type="button" title="Preview output" aria-label="Preview output" @click.stop="previewNode">
          <i class="pi pi-eye" />
        </button>
      </div>
    </header>

    <ul v-if="data.inputs?.length" class="inputs">
      <li v-for="input in data.inputs" :key="input.id" class="row">
        <Handle :id="input.id" type="target" :position="Position.Left" class="handle handle-input" />
        <span>{{ input.label }}</span>
      </li>
    </ul>

    <div class="body">
      <div class="meta-row">
        <span class="label meta-label">Input</span>
        <Select
          v-if="data.inputModeOptions"
          :model-value="data.inputMode"
          :options="data.inputModeOptions"
          option-label="label"
          option-value="id"
          aria-label="GeoNames input mode"
          class="nodrag"
          :disabled="data.status === 'running'"
          @update:model-value="data.onInputModeChange?.($event)"
          @click.stop
        />
        <span>{{ data.inputLabel }}</span>
      </div>
      <div class="meta-row">
        <span class="label meta-label">Status</span>
        <span class="status-line" :class="data.status === 'success' && data.lookupErrors?.length ? 'status-warning' : `status-${data.status}`">
          {{ data.status === 'success' && data.lookupErrors?.length ? 'completed with warnings' : data.status }}
          <template v-if="data.totalCount > 0">· {{ data.processedCount }} / {{ data.totalCount }}</template>
          <template v-if="data.cachedCount > 0">· {{ data.cachedCount }} cached</template>
        </span>
      </div>
    </div>

    <ul class="outputs">
      <li v-for="output in data.outputs" :key="output.id" class="row">
        <span>{{ output.label }}</span>
        <Handle
          :id="output.id"
          type="source"
          :position="Position.Right"
          class="handle handle-output"
        />
      </li>
    </ul>

    <Message v-if="data.lastError" severity="error" :closable="false" class="error-box">{{ data.lastError }}</Message>
    <EnrichmentLookupWarnings :errors="data.lookupErrors ?? []" class="error-box" />

    <footer>
      <Button
        :label="data.actionLabel"
        icon="pi pi-refresh"
        size="small"
        :loading="data.status === 'running'"
        @click.stop="runNode"
      />
      <span>{{ data.footerNote }}</span>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.enrich-node {
  min-width: 290px;
  max-width: 360px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  font-size: 0.84rem;
}

header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--enrich-header-bg);
  border-bottom: 1px solid var(--color-border);
  color: var(--enrich-header-color);

  div {
    display: flex;
    flex-direction: column;
  }

  span {
    font-size: 0.76rem;
    color: var(--enrich-header-subtle);
  }
}

.preview-btn {
  border: 1px solid var(--enrich-preview-border);
  background: rgba(255, 255, 255, 0.72);
  color: inherit;

  &:hover {
    background: white;
    border-color: color-mix(in srgb, var(--enrich-header-color) 35%, white);
  }
}

.header-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
}

.delete-btn {
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.meta-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 0.72rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.inputs,
.outputs {
  list-style: none;
  padding: 0;
  margin: 0;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: 0;
  }
}

footer {
  padding: 6px 12px;
  background: var(--color-surface-2);
  border-top: 1px solid var(--color-border);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-line {
  text-transform: capitalize;
}

.status-running { color: var(--enrich-header-subtle); }
.status-success { color: #166534; }
.status-error { color: #b91c1c; }
.status-warning { color: #92400e; }

.error-box {
  margin: 8px 12px 0;
}

.handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--color-surface-1) !important;
}

.handle-input {
  background: var(--enrich-input-handle) !important;
}

.handle-output {
  background: var(--enrich-output-handle) !important;
}
</style>

