/** Selection highlights exactly the selected entity and its direct visible neighbors. */
export function graphFocus(selected: string | null | undefined, links: readonly { source: string; target: string }[]): Set<string> | null {
  if (!selected) return null
  const focused = new Set([selected])
  for (const { source, target } of links) {
    if (source === selected) focused.add(target)
    if (target === selected) focused.add(source)
  }
  return focused
}
