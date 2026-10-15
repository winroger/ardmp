import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { useVueFlow, type Connection, type EdgeMouseEvent } from '@vue-flow/core'
import { createColumnMappingEdge } from '@/domain/Mapping'
import type { DataSource } from '@/domain/DataSource'
import { getConnectionHandlers } from '@/features/mapping/mappingExtensionRegistry'
import type { useDataStore } from '@/stores/dataStore'
import type { useMappingStore } from '@/stores/mappingStore'

type MappingStore = ReturnType<typeof useMappingStore>
type DataStore = ReturnType<typeof useDataStore>

interface ToastLike {
  add(message: {
    severity: string
    summary: string
    detail?: string
    life?: number
  }): void
}

interface ConfirmLike {
  require(options: {
    header: string
    message: string
    icon?: string
    acceptLabel?: string
    rejectLabel?: string
    acceptClass?: string
    accept: () => void
  }): void
}

interface UseCanvasConnectionsOptions {
  dataStore: DataStore
  mappingStore: MappingStore
  sources: Ref<DataSource[]>
  toast: ToastLike
  confirm: ConfirmLike
}

export function useCanvasConnections(options: UseCanvasConnectionsOptions) {
  const { onConnect, onEdgeClick } = useVueFlow()
  const selectedEdgeId = ref<string | null>(null)

  onConnect((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const sourceHandle = connection.sourceHandle ?? ''
    const targetHandle = connection.targetHandle ?? ''

    if (connection.source.startsWith('src:') && connection.target.startsWith('shape:')) {
      const sourceId = connection.source.slice(4)
      const shapeIri = connection.target.slice(6)
      const sourceHeader = sourceHandle.startsWith('h:') ? sourceHandle.slice(2) : ''
      const propertyPath = targetHandle.startsWith('p:') ? targetHandle.slice(2) : ''
      if (!sourceHeader || !propertyPath) return
      options.mappingStore.set(createColumnMappingEdge({ sourceId, sourceHeader, shapeIri, propertyPath }))
      return
    }

    for (const handler of getConnectionHandlers()) {
      if (!handler.canHandleConnection(connection)) continue
      if (handler.connect(connection, {
        dataStore: options.dataStore,
        mappingStore: options.mappingStore,
        sources: options.sources.value,
        toast: options.toast,
      })) return
    }
  })

  onEdgeClick((event: EdgeMouseEvent) => {
    selectedEdgeId.value = event.edge.id
    if (isStructuralEdge(event.edge.id)) return
    options.confirm.require({
      header: 'Remove connection',
      message: 'Delete this mapping connection?',
      icon: 'pi pi-question-circle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptClass: 'p-button-danger',
      accept: () => {
        if (deleteSelectedEdge(event.edge.id)) {
          selectedEdgeId.value = null
          options.toast.add({ severity: 'success', summary: 'Connection deleted', life: 2000 })
        }
      },
    })
  })

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (!selectedEdgeId.value) return

    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
    if (isStructuralEdge(selectedEdgeId.value)) return

    if (deleteSelectedEdge(selectedEdgeId.value)) {
      selectedEdgeId.value = null
      options.toast.add({ severity: 'success', summary: 'Connection deleted', life: 2000 })
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

  function deleteSelectedEdge(edgeId: string): boolean {
    return deleteMappingEdgeById(edgeId)
      || deleteExtensionUiEdgeById(edgeId)
  }

  function deleteMappingEdgeById(edgeId: string): boolean {
    if (!edgeId.startsWith('e:')) return false
    const rest = edgeId.slice(2)
    const separator = rest.lastIndexOf('::')
    if (separator < 0) return false

    const shapeIri = rest.slice(0, separator)
    const propertyPath = rest.slice(separator + 2)
    const edge = options.mappingStore.state.forProperty(shapeIri, propertyPath)
    if (edge) {
      for (const handler of getConnectionHandlers()) {
        if (handler.deleteMappingEdge?.(edge, shapeIri, propertyPath, {
          dataStore: options.dataStore,
          mappingStore: options.mappingStore,
          sources: options.sources.value,
          toast: options.toast,
        })) {
          return true
        }
      }
    }

    options.mappingStore.unset(shapeIri, propertyPath)
    return true
  }

  function deleteExtensionUiEdgeById(edgeId: string): boolean {
    for (const handler of getConnectionHandlers()) {
      if (handler.deleteUiEdge?.(edgeId, {
        dataStore: options.dataStore,
        mappingStore: options.mappingStore,
        sources: options.sources.value,
        toast: options.toast,
      })) {
        return true
      }
    }
    return false
  }

  return {
    selectedEdgeId,
  }
}

function isStructuralEdge(edgeId: string): boolean {
  return edgeId.startsWith('ref:') || edgeId.startsWith('air:') || edgeId.startsWith('tbl:')
}


