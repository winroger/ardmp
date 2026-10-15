import type { ExtensionUiEdge } from '@/features/mapping/extensions/core/types'

export interface MergeNodeConfig {
  id: string
  inputCount: number
  separator?: string
}

export type MergeUiEdge = ExtensionUiEdge
