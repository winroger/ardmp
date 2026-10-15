<script setup lang="ts">
import type { DataSource } from '@/domain/DataSource'

defineProps<{
  inputSource: DataSource | null
  outputSource: DataSource | null
}>()

function displayCell(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <section class="transform-preview">
    <div class="preview-block">
      <header>
        <h3 class="panel-title">Input</h3>
        <p v-if="inputSource" class="helper-text">{{ inputSource.rows.length }} rows · {{ inputSource.headers.length }} columns</p>
      </header>
      <div v-if="inputSource" class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="header in inputSource.headers" :key="header">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in inputSource.rows" :key="`input-${rowIndex}`">
              <td v-for="(cell, cellIndex) in row" :key="`input-${rowIndex}-${cellIndex}`">{{ displayCell(cell) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">Connect the required fields to inspect the transform input.</p>
    </div>

    <div class="preview-block">
      <header>
        <h3 class="panel-title">Output</h3>
        <p v-if="outputSource" class="helper-text">{{ outputSource.rows.length }} rows · {{ outputSource.headers.length }} columns</p>
      </header>
      <div v-if="outputSource" class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="header in outputSource.headers" :key="header">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in outputSource.rows" :key="`output-${rowIndex}`">
              <td v-for="(cell, cellIndex) in row" :key="`output-${rowIndex}-${cellIndex}`">{{ displayCell(cell) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">No WKT output available yet.</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.transform-preview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4);
}

.preview-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.table-scroll {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: auto;
  max-height: 65vh;
  background: var(--color-surface);
}

.data-table {
  width: max-content;
  min-width: 100%;
}

.data-table th,
.data-table td {
  white-space: nowrap;
}

.empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
</style>


