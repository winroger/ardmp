import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCanvasSetupMenu } from '@/features/mapping/useCanvasSetupMenu'
import { useDataStore } from '@/stores/dataStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useProjectStore } from '@/stores/projectStore'
import { useShapesStore } from '@/stores/shapesStore'

const loadEmbeddedExampleProjectMock = vi.fn()

vi.mock('@/services/project/loadEmbeddedExampleProject', () => ({
  loadEmbeddedExampleProject: (...args: unknown[]) => loadEmbeddedExampleProjectMock(...args),
}))

describe('useCanvasSetupMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    loadEmbeddedExampleProjectMock.mockReset()
    loadEmbeddedExampleProjectMock.mockResolvedValue(undefined)
  })

  it('groups load example and reset under a top-level options menu', () => {
    const dataStore = useDataStore()
    const metadataStore = useMetadataStore()
    const mappingStore = useMappingStore()
    const projectStore = useProjectStore()
    const shapesStore = useShapesStore()

    const menu = useCanvasSetupMenu({
      dataStore,
      metadataStore,
      shapesStore,
      mappingStore,
      projectStore,
      toast: { add: vi.fn() },
      confirm: { require: vi.fn() },
    })

    const labels = menu.menuItems.value.map(item => item.label)
    expect(labels).toEqual(['Source Data', 'Target Schema', 'Enrichment', 'Transformation', 'Options'])

    const options = menu.menuItems.value.at(-1)
    expect(options?.items?.map(item => item.label)).toEqual(['Load Example', 'Reset all'])
  })

  it('loads the example immediately when the workspace is empty', async () => {
    const dataStore = useDataStore()
    const metadataStore = useMetadataStore()
    const mappingStore = useMappingStore()
    const projectStore = useProjectStore()
    const shapesStore = useShapesStore()
    const confirm = { require: vi.fn() }

    const menu = useCanvasSetupMenu({
      dataStore,
      metadataStore,
      shapesStore,
      mappingStore,
      projectStore,
      toast: { add: vi.fn() },
      confirm,
      resetUiState: vi.fn(),
    })

    const loadExample = menu.menuItems.value.at(-1)?.items?.[0]?.command
    loadExample?.()
    await Promise.resolve()

    expect(confirm.require).not.toHaveBeenCalled()
    expect(loadEmbeddedExampleProjectMock).toHaveBeenCalledTimes(1)
  })
})
