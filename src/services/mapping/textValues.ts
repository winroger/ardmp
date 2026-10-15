/** Text operations accept scalar lists, never implicit object stringification. */
export function scalarText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') throw new Error('Extract a text or ID field from objects before using merge or split.')
  return String(value).trim()
}

export function mergeText(values: unknown[], separator: string): string {
  return values.flatMap(value => Array.isArray(value) ? value : [value]).map(scalarText).filter(Boolean).join(separator)
}
