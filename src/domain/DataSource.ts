/**
 * Provider-neutral tabular source model used by mapping, preview, RDF, and export.
 *
 * Concrete importers and enrichment nodes should create DataSource instances from
 * their module code instead of adding provider-specific classes here.
 */
export interface DataSource {
  /** Stable key used for mapping references. */
  readonly id: string
  /** Human-readable display name. */
  readonly name: string
  /** Core data shape. Provider details live in `origin`. */
  readonly kind: 'tabular'
  /** High-level role in the mapping pipeline. */
  readonly role: DataSourceRole
  /** Where this source came from. */
  readonly origin: DataSourceOrigin
  /** Column headers in source order. */
  readonly headers: string[]
  /** Raw rows, indexed by header position. */
  readonly rows: unknown[][]
  /** Optional per-column metadata preserved from the source system. */
  readonly columns?: DataSourceColumn[]
  /** Optional: internal helper sources should not appear as standalone table nodes. */
  readonly hidden?: boolean
  /**
   * Optional storage record IDs used for row alignment and linked records.
   * These are also the default URI suffix unless a shape selects its own
   * identifier column. When absent the first column is the default.
   */
  readonly recordIds?: string[]
}

export type DataSourceColumnDatatype =
  | 'array'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'duration'
  | 'number'
  | 'object'
  | 'string'
  | 'unknown'

export interface DataSourceColumn {
  name: string
  datatype: DataSourceColumnDatatype
  nativeType?: string
}

export type DataSourceRole = 'source' | 'derived'

export type DataSourceOrigin =
  | {
      kind: 'uploaded-file'
      mediaType?: string
      filename?: string
    }
  | {
      kind: 'remote-table'
      provider: string
      externalRef: Record<string, string>
    }
  | {
      kind: 'node-output'
      provider: string
      nodeId: string
      inputSourceId?: string
    }
  | {
      kind: 'generated'
      provider?: string
      externalRef?: Record<string, string>
    }

export class TabularDataSource implements DataSource {
  readonly kind = 'tabular' as const
  readonly id: string
  readonly name: string
  readonly headers: string[]
  readonly rows: unknown[][]
  readonly columns?: DataSourceColumn[]
  readonly role: DataSourceRole
  readonly origin: DataSourceOrigin
  readonly hidden?: boolean
  readonly recordIds?: string[]

  constructor(options: {
    id: string
    name: string
    headers: string[]
    rows: unknown[][]
    columns?: DataSourceColumn[]
    recordIds?: string[]
    role?: DataSourceRole
    origin?: DataSourceOrigin
    hidden?: boolean
  }) {
    this.id = options.id
    this.name = options.name
    this.headers = options.headers
    this.rows = options.rows
    this.columns = options.columns?.map(column => ({ ...column }))
    this.recordIds = options.recordIds
    this.role = options.role ?? 'source'
    this.origin = options.origin ?? { kind: 'generated' }
    this.hidden = options.hidden
  }
}

export function createUploadedTabularSource(options: {
  id: string
  name: string
  headers: string[]
  rows: unknown[][]
  columns?: DataSourceColumn[]
  recordIds?: string[]
  filename?: string
  mediaType?: string
}): DataSource {
  return new TabularDataSource({
    ...options,
    origin: {
      kind: 'uploaded-file',
      filename: options.filename,
      mediaType: options.mediaType,
    },
  })
}

export function createRemoteTabularSource(options: {
  id: string
  name: string
  provider: string
  externalRef: Record<string, string>
  headers: string[]
  rows: unknown[][]
  columns?: DataSourceColumn[]
  recordIds?: string[]
}): DataSource {
  return new TabularDataSource({
    id: options.id,
    name: options.name,
    headers: options.headers,
    rows: options.rows,
    columns: options.columns,
    recordIds: options.recordIds,
    origin: {
      kind: 'remote-table',
      provider: options.provider,
      externalRef: options.externalRef,
    },
  })
}

export function createNodeOutputTabularSource(options: {
  id: string
  name: string
  provider: string
  nodeId: string
  inputSourceId?: string
  headers: string[]
  rows: unknown[][]
  columns?: DataSourceColumn[]
  recordIds?: string[]
  hidden?: boolean
}): DataSource {
  return new TabularDataSource({
    id: options.id,
    name: options.name,
    headers: options.headers,
    rows: options.rows,
    columns: options.columns,
    recordIds: options.recordIds,
    role: 'derived',
    hidden: options.hidden ?? true,
    origin: {
      kind: 'node-output',
      provider: options.provider,
      nodeId: options.nodeId,
      ...(options.inputSourceId ? { inputSourceId: options.inputSourceId } : {}),
    },
  })
}

export function isCanvasVisibleDataSource(source: DataSource): boolean {
  return source.role === 'source' && !source.hidden
}

export function dataSourceOriginLabel(source: DataSource): string {
  switch (source.origin.kind) {
    case 'uploaded-file':
      return source.origin.mediaType === 'text/csv' ? 'CSV table' : 'Uploaded table'
    case 'remote-table':
      return `${source.origin.provider} table`
    case 'node-output':
      return `${source.origin.provider} result table`
    case 'generated':
    default:
      return source.origin.provider ? `${source.origin.provider} table` : 'Generated table'
  }
}


