<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { DataSource } from '@/domain/DataSource'
import { CANVAS_NODE_COLORS } from '@/features/mapping/canvasTheme'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { detectLinkedColumns, type LinkedColumnInfo } from '@/services/mapping/linkDetector'
import { hasExplicitSourceHeaderMapping } from '@/services/mapping/stagingSemantics'

const props = defineProps<{ data: { source: DataSource; onPreview?: () => void } }>()
const dataStore = useDataStore()
const mappingStore = useMappingStore()

/** Detected linked-record columns, indexed by header name. */
const linkInfo = computed<Map<string, LinkedColumnInfo>>(() => {
  const map = new Map<string, LinkedColumnInfo>()
  const detected = detectLinkedColumns(props.data.source, dataStore.sources)
  for (const info of detected) map.set(info.header, info)
  return map
})

const mappedHeaders = computed(() =>
  props.data.source.headers.filter(header => isMappedColumn(header)),
)

const stagingGraphState = computed(() =>
  mappingStore.stagingGraphStateForSource(props.data.source.id, props.data.source.headers, mappedHeaders.value),
)

function toggleStagingColumn(header: string): void {
  if (isMappedColumn(header)) return
  const active = mappingStore.isStagingColumnActive(props.data.source.id, header)
  mappingStore.setStagingColumnActive(props.data.source.id, header, !active)
}

function toggleStagingGraph(): void {
  mappingStore.setStagingGraphActive(
    props.data.source.id,
    props.data.source.headers,
    stagingGraphState.value === 'disabled',
    mappedHeaders.value,
  )
}

function isStagingColumnActive(header: string): boolean {
  return mappingStore.isStagingColumnActive(props.data.source.id, header)
}

function isMappedColumn(header: string): boolean {
  return hasExplicitSourceHeaderMapping(mappingStore.state, props.data.source.id, header)
}

function stagingStateForHeader(header: string): 'mapped' | 'staging' | 'disabled' {
  if (isMappedColumn(header)) return 'mapped'
  return isStagingColumnActive(header) ? 'staging' : 'disabled'
}

function stagingTitleForHeader(header: string): string {
  const state = stagingStateForHeader(header)
  if (state === 'mapped') return 'Column is mapped and always included'
  if (state === 'staging') return 'Disable staging column'
  return 'Enable staging column'
}

function stagingGraphTitle(): string {
  if (stagingGraphState.value === 'enabled') return 'Disable staging graph for this imported node'
  if (stagingGraphState.value === 'partial') return 'Enable staging graph for all unmapped columns'
  return 'Enable staging graph for this imported node'
}
</script>

<template>
  <div
    class="table-node"
    :style="{
      '--table-header-bg': CANVAS_NODE_COLORS.importer.headerBackground,
      '--table-header-color': CANVAS_NODE_COLORS.importer.headerColor,
      '--table-preview-border': CANVAS_NODE_COLORS.importer.previewBorderColor,
      '--table-link-bg': CANVAS_NODE_COLORS.importer.accentBackground,
      '--table-link-hover-bg': CANVAS_NODE_COLORS.importer.accentHoverBackground,
      '--table-link-color': CANVAS_NODE_COLORS.importer.handleColor,
      '--table-handle-color': CANVAS_NODE_COLORS.importer.handleColor,
    }"
  >
    <header>
      <Handle
        id="table-parent"
        type="target"
        :position="Position.Left"
        class="handle handle-parent"
      />
      <i class="pi pi-table" />
      <span class="name">{{ data.source.name }}</span>
      <button
        class="preview-btn icon-pill-button"
        type="button"
        title="Preview table"
        aria-label="Preview table"
        @click.stop="data.onPreview?.()"
      >
        <i class="pi pi-eye" />
      </button>
      <button
        class="graph-toggle icon-pill-button"
        type="button"
        :class="`is-${stagingGraphState}`"
        :title="stagingGraphTitle()"
        :aria-pressed="stagingGraphState !== 'disabled'"
        @click.stop="toggleStagingGraph"
      >
        <i :class="stagingGraphState === 'disabled' ? 'pi pi-sitemap' : stagingGraphState === 'partial' ? 'pi pi-minus-circle' : 'pi pi-check-circle'" />
      </button>
    </header>
    <ul class="headers">
      <li
        v-for="header in data.source.headers"
        :key="header"
        class="row"
        :class="[
          { 'is-link': linkInfo.has(header) },
          `is-${stagingStateForHeader(header)}`,
        ]"
      >
        <i v-if="linkInfo.has(header)" class="pi pi-link link-icon" />
        <span class="header-name">{{ header }}</span>
        <button
          class="staging-toggle"
          type="button"
          :class="`is-${stagingStateForHeader(header)}`"
          :title="stagingTitleForHeader(header)"
          :aria-pressed="stagingStateForHeader(header) !== 'disabled'"
          :disabled="isMappedColumn(header)"
          @click.stop="toggleStagingColumn(header)"
        >
          <i :class="stagingStateForHeader(header) === 'disabled' ? 'pi pi-times-circle' : 'pi pi-check-circle'" />
        </button>
        <Handle
          :id="`h:${header}`"
          type="source"
          :position="Position.Right"
          class="handle"
          :class="linkInfo.has(header) ? 'handle-link' : 'handle-source'"
        />
      </li>
    </ul>
    <footer class="meta">
      {{ data.source.rows.length }} rows
    </footer>
  </div>
</template>

<style scoped lang="scss">
.table-node {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 260px;
  max-width: 340px;
  font-size: 0.85rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
header {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--table-header-bg);
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  color: var(--table-header-color);
}
.name { flex: 1; word-break: break-all; }
.preview-btn {
  border: 1px solid var(--table-preview-border);
  background: rgba(255, 255, 255, 0.72);
  color: inherit;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: white;
    border-color: color-mix(in srgb, var(--table-header-color) 35%, white);
  }
}

.graph-toggle {
  border: 1px solid var(--table-preview-border);
  background: rgba(255, 255, 255, 0.72);
  color: inherit;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: white;
    border-color: color-mix(in srgb, var(--table-header-color) 35%, white);
  }

  &.is-enabled {
    background: #f0fdf4;
    border-color: #86efac;
    color: #166534;
  }

  &.is-partial {
    background: #fffbeb;
    border-color: #fcd34d;
    color: #a16207;
  }

  &.is-disabled {
    background: #f3f4f6;
    border-color: #d1d5db;
    color: #6b7280;
  }
}

.headers { list-style: none; padding: 0; margin: 0; }
.row {
  position: relative;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 6px;
  &:last-child { border-bottom: none; }

  &.is-link {
    background: var(--table-link-bg);
    &:hover { background: var(--table-link-hover-bg); }
  }

  &:not(.is-link):hover { background: var(--color-surface-2); }

  &.is-disabled {
    opacity: 0.62;
  }
}

.link-icon {
  font-size: 0.75rem;
  color: var(--table-link-color);
  flex-shrink: 0;
}

.staging-toggle {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface-1);
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: var(--color-text);
    border-color: var(--table-header-bg);
  }

  &.is-staging {
    background: #fff7ed;
    border-color: #fdba74;
    color: #c2410c;
  }

  &.is-mapped {
    background: #f0fdf4;
    border-color: #86efac;
    color: #15803d;
    cursor: default;
  }

  &.is-disabled {
    background: #f3f4f6;
    border-color: #d1d5db;
    color: #6b7280;
  }

  &:disabled {
    opacity: 1;
  }
}

.header-name {
  flex: 1;
  font-family: var(--font-mono);
  word-break: break-all;
}

.link-target-badge {
  font-size: 0.7rem;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--color-surface-1) !important;
}
.handle-parent { background: #d1d5db !important; }
.handle-source { background: var(--table-handle-color) !important; }
.handle-link   { background: var(--table-handle-color) !important; }

.meta {
  padding: 6px 12px;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-2);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
</style>


