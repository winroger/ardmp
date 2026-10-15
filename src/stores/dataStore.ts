import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createNodeOutputTabularSource,
  type DataSource,
} from '@/domain/DataSource'
import {
  createDataSourceSnapshots,
  restoreDataSourcesFromSnapshot,
  type DataSourceSnapshot,
} from '@/services/project/projectSnapshot'

export const useDataStore = defineStore('data', () => {
  const sources = ref<DataSource[]>([])

  function upsertSource(source: DataSource): void {
    const existingIdx = sources.value.findIndex(item => item.id === source.id)
    if (existingIdx >= 0) sources.value.splice(existingIdx, 1, source)
    else sources.value.push(source)
  }

  function addNodeOutputSource(
    provider: string,
    nodeId: string,
    headers: string[],
    rows: unknown[][],
    recordIds?: string[],
    inputSourceId?: string,
  ): string {
    const sourceId = `${provider}-output:${nodeId}`
    upsertSource(createNodeOutputTabularSource({
      id: sourceId,
      name: `${provider} ${nodeId}`,
      provider,
      nodeId,
      inputSourceId,
      headers,
      rows,
      recordIds,
    }))
    return sourceId
  }

  function remove(id: string): void {
    sources.value = sources.value.filter(s => s.id !== id)
  }

  function removeNodeOutputSources(nodeId: string): void {
    sources.value = sources.value.filter(source =>
      !(source.origin.kind === 'node-output' && source.origin.nodeId === nodeId),
    )
  }

  function findById(id: string): DataSource | undefined {
    return sources.value.find(s => s.id === id)
  }

  function createSnapshot(): DataSourceSnapshot[] {
    return createDataSourceSnapshots(sources.value)
  }

  function restoreSnapshot(snapshot: DataSourceSnapshot[]): void {
    sources.value = restoreDataSourcesFromSnapshot(snapshot)
  }

  function reset(): void {
    sources.value = []
  }

  return {
    sources,
    upsertSource,
    addNodeOutputSource,
    remove,
    removeNodeOutputSources,
    findById,
    createSnapshot,
    restoreSnapshot,
    reset,
  }
})


