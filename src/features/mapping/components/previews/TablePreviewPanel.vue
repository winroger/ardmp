<script setup lang="ts">
import type { DataSource } from '@/domain/DataSource'

const props = defineProps<{ source: DataSource }>()

function displayCell(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <section class="table-preview">
    <header class="preview-header">
      <div>
        <h3 class="panel-title">{{ props.source.name }}</h3>
        <p class="helper-text">{{ props.source.rows.length }} rows · {{ props.source.headers.length }} columns</p>
      </div>
    </header>

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="header in props.source.headers" :key="header">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in props.source.rows" :key="rowIndex">
            <td v-for="(cell, cellIndex) in row" :key="`${rowIndex}-${cellIndex}`">{{ displayCell(cell) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped lang="scss">
.table-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.table-scroll {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
  background: var(--color-surface);
}

.data-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}

.data-table th,
.data-table td {
  white-space: nowrap;
}

.data-table th {
  z-index: 1;
}
</style>

