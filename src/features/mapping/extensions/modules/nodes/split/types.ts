import type { ExtensionUiEdge } from '@/features/mapping/extensions/core/types'

export type SplitMode = 'columns' | 'array'

export interface SplitNodeConfig {
  id: string
  mode: SplitMode
  separator: string
}

export type SplitUiEdge = ExtensionUiEdge
