import showcaseProject from '@/assets/examples/showcase-project.json'
import type { useProjectStore } from '@/stores/projectStore'
import type { ProjectSnapshot } from '@/services/project/projectSnapshot'

type ProjectStore = ReturnType<typeof useProjectStore>

interface ToastLike {
  add(message: {
    severity: string
    summary: string
    detail?: string
    life?: number
  }): void
}

interface LoadEmbeddedExampleProjectOptions {
  projectStore: ProjectStore
  toast: ToastLike
  resetUiState?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertProjectSnapshotLike(value: unknown): asserts value is ProjectSnapshot {
  if (!isRecord(value)) throw new Error('Embedded example is not an object.')
  if (value.version !== 1) throw new Error('Embedded example uses an unsupported version.')
  if (!isRecord(value.project)) throw new Error('Embedded example is missing project metadata.')
  if (!Array.isArray(value.sources)) throw new Error('Embedded example is missing sources.')
  if (!Array.isArray(value.shapeProfiles)) throw new Error('Embedded example is missing shape profiles.')
  if (!isRecord(value.mapping)) throw new Error('Embedded example is missing mapping state.')
}

export function getEmbeddedExampleProjectSnapshot(): ProjectSnapshot {
  const snapshot = structuredClone(showcaseProject) as unknown
  assertProjectSnapshotLike(snapshot)
  return snapshot
}

export async function loadEmbeddedExampleProject(
  options: LoadEmbeddedExampleProjectOptions,
): Promise<void> {
  try {
    const snapshot = getEmbeddedExampleProjectSnapshot()
    options.resetUiState?.()
    options.projectStore.restoreSnapshot(snapshot)
    options.toast.add({
      severity: 'success',
      summary: 'Example loaded',
      detail: 'The built-in showcase project replaced the current workspace.',
      life: 3500,
    })
  } catch (error) {
    options.toast.add({
      severity: 'error',
      summary: 'Example failed to load',
      detail: error instanceof Error ? error.message : String(error),
      life: 5000,
    })
  }
}
