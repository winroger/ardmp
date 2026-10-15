<script setup lang="ts">
import Button from 'primevue/button'
import { Handle, Position } from '@vue-flow/core'
import { CANVAS_NODE_COLORS } from '@/features/mapping/canvasTheme'
import { ref, watch } from 'vue'

type TransformNodePort = {
  id: string
  label: string
  state?: 'pending' | 'connected'
  stateLabel?: string
}

const props = defineProps<{
  data: {
    title: string
    subtitle: string
    icon: string
    inputs: TransformNodePort[]
    outputs: TransformNodePort[]
    previewLabel?: string
    theme?: {
      headerBackground?: string
      headerColor?: string
      headerSubtleColor?: string
      previewBorderColor?: string
      inputHandleColor?: string
      outputHandleColor?: string
    }
    onPreview?: () => void
    onDelete?: () => void
    onAddInput?: () => void
    separator?: string
    onSeparatorChange?: (value: string) => void
    mode?: string
    modeOptions?: { value: string; label: string }[]
    onModeChange?: (value: string) => void
    note?: string
  }
}>()

function separatorText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}

function separatorValue(value: string): string {
  const escapes: Record<string, string> = { '\\': '\\', n: '\n', r: '\r', t: '\t' }
  return value.replace(/\\([\\nrt])/g, (_match, escape: string) => escapes[escape])
}

const separatorDraft = ref(separatorText(props.data.separator ?? ''))
watch(() => props.data.separator, value => {
  if (separatorValue(separatorDraft.value) !== (value ?? '')) separatorDraft.value = separatorText(value ?? '')
})

function editSeparator(event: Event): void {
  separatorDraft.value = (event.target as HTMLInputElement).value
  props.data.onSeparatorChange?.(separatorValue(separatorDraft.value))
}

function selectSeparator(value: string): void {
  separatorDraft.value = separatorText(value)
  props.data.onSeparatorChange?.(value)
}

function separatorDescription(): string {
  const value = separatorValue(separatorDraft.value)
  if (!value) return 'Empty separator'
  if (value === ' ') return 'Single space'
  if (value === '\n') return 'Line break'
  if (value === '\r\n') return 'Line break (CRLF)'
  if (value === '\t') return 'Tab'
  return `Separator: ${JSON.stringify(value)}`
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
    class="transform-node"
    :style="{
      '--transform-header-bg': data.theme?.headerBackground ?? CANVAS_NODE_COLORS.transform.headerBackground,
      '--transform-header-color': data.theme?.headerColor ?? CANVAS_NODE_COLORS.transform.headerColor,
      '--transform-header-subtle': data.theme?.headerSubtleColor ?? CANVAS_NODE_COLORS.transform.subtleColor,
      '--transform-preview-border': data.theme?.previewBorderColor ?? CANVAS_NODE_COLORS.transform.previewBorderColor,
      '--transform-input-handle': data.theme?.inputHandleColor ?? CANVAS_NODE_COLORS.transform.inputHandleColor,
      '--transform-output-handle': data.theme?.outputHandleColor ?? CANVAS_NODE_COLORS.transform.outputHandleColor,
    }"
  >
    <header>
      <i :class="data.icon" />
      <div>
        <strong>{{ data.title }}</strong>
        <span>{{ data.subtitle }}</span>
      </div>
      <div class="header-actions">
        <button class="preview-btn delete-btn icon-pill-button icon-pill-button--danger" type="button" title="Delete node" aria-label="Delete node" @click.stop="deleteNode">
          <i class="pi pi-trash" />
        </button>
        <button class="preview-btn icon-pill-button" type="button" title="Preview transform" aria-label="Preview transform" @click.stop="previewNode">
          <i class="pi pi-eye" />
        </button>
      </div>
    </header>

    <div v-if="data.onSeparatorChange || data.onModeChange" class="configuration nodrag nowheel nokey" @keydown.stop @keyup.stop>
      <label v-if="data.onModeChange">
        <span>Output</span>
        <select :value="data.mode" aria-label="Split output mode" @change="data.onModeChange?.(($event.target as HTMLSelectElement).value)">
          <option v-for="option in data.modeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label v-if="data.onSeparatorChange">
        <span>Separator</span>
        <input type="text" :value="separatorDraft" aria-label="Separator" autocomplete="off" spellcheck="false" @input="editSeparator" />
      </label>
      <template v-if="data.onSeparatorChange">
        <div class="separator-presets">
          <button type="button" @click.stop="selectSeparator(' ')">Space</button>
          <button type="button" @click.stop="selectSeparator('\n')">Line break</button>
        </div>
        <small class="separator-description" aria-live="polite">{{ separatorDescription() }}</small>
        <small>Use \n for line breaks or \t for tabs.</small>
      </template>
      <small v-if="data.note">{{ data.note }}</small>
    </div>

    <ul class="inputs">
      <li v-for="input in data.inputs" :key="input.id" class="row">
        <Handle :id="input.id" type="target" :position="Position.Left" class="handle handle-input" />
        <span>{{ input.label }}</span>
        <small v-if="input.stateLabel" :class="input.state ?? 'pending'">{{ input.stateLabel }}</small>
      </li>
    </ul>

    <div v-for="output in data.outputs" :key="output.id" class="output-row">
      <span>{{ output.label }}</span>
      <Handle :id="output.id" type="source" :position="Position.Right" class="handle handle-output" />
    </div>

    <div class="footer-actions">
      <Button v-if="data.onAddInput" label="Add input" icon="pi pi-plus" size="small" text @click.stop="data.onAddInput()" />
      <Button :label="data.previewLabel ?? 'Preview'" icon="pi pi-eye" size="small" text @click.stop="previewNode" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.transform-node {
  min-width: 260px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--transform-header-bg);
  border-bottom: 1px solid var(--color-border);
  color: var(--transform-header-color);

  div {
    display: flex;
    flex-direction: column;
  }

  span {
    font-size: 0.76rem;
    color: var(--transform-header-subtle);
  }
}

.preview-btn {
  border: 1px solid var(--transform-preview-border);
  background: rgba(255, 255, 255, 0.72);
  color: inherit;

  &:hover {
    background: white;
    border-color: color-mix(in srgb, var(--transform-header-color) 35%, white);
  }
}

.header-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
}

.delete-btn {
}

.inputs {
  list-style: none;
  padding: 0;
  margin: 0;
}

.configuration { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--color-border); }
.configuration label { display: flex; flex-direction: column; gap: 4px; }
.configuration input, .configuration select { padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text); }
.configuration small { max-width: 280px; color: var(--color-text-muted); }
.separator-presets { display: flex; gap: 6px; }
.separator-presets button { padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text); cursor: pointer; }

.row,
.output-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}

.output-row {
  background: var(--color-surface-2);
  font-weight: 600;
}

.footer-actions {
  padding: 4px 8px 8px;
  display: flex;
  justify-content: flex-end;
}

small.pending { color: var(--color-text-muted); }
small.connected { color: #166534; }

.handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--color-surface-1) !important;
}

.handle-input { background: var(--transform-input-handle) !important; }
.handle-output { background: var(--transform-output-handle) !important; }
</style>

