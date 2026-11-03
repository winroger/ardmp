export interface NetworkNode { id: string; x: number; y: number; group?: string }
export interface NetworkEdge { source: string; target: string }

/** Atlas-style layout: spread an anchor type, then place neighbors at their barycenters. */
export function layoutReviewNetwork(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[]): NetworkNode[] {
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const scores = new Map<string, number>()
  const links: Array<readonly [number, number]> = []
  for (const edge of edges) {
    const a = index.get(edge.source), b = index.get(edge.target)
    if (a === undefined || b === undefined || a === b) continue
    links.push([a, b])
    if (nodes[a].group !== nodes[b].group) {
      const group = nodes[a].group ?? ''
      scores.set(group, (scores.get(group) ?? 0) + 1)
    }
  }
  const anchorGroup = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? nodes[0]?.group ?? ''
  const anchors = nodes.filter(node => (node.group ?? '') === anchorGroup)
  const result = nodes.map(node => ({ ...node }))
  const radius = Math.max(80, Math.sqrt(anchors.length) * 23)
  anchors.forEach((node, i) => {
    const angle = i * 2.399963, r = radius * Math.sqrt((i + 0.5) / anchors.length)
    const position = result[index.get(node.id)!]
    position.x = Math.cos(angle) * r; position.y = Math.sin(angle) * r
  })
  const centers = new Map<number, { x: number; y: number; count: number }>()
  for (const [a, b] of links) {
    const aIsAnchor = (nodes[a].group ?? '') === anchorGroup, bIsAnchor = (nodes[b].group ?? '') === anchorGroup
    if (aIsAnchor === bIsAnchor) continue
    const neighbor = aIsAnchor ? b : a, anchor = result[aIsAnchor ? a : b]
    const center = centers.get(neighbor) ?? { x: 0, y: 0, count: 0 }
    center.x += anchor.x; center.y += anchor.y; center.count++
    centers.set(neighbor, center)
  }
  for (const [i, center] of centers) {
    const angle = i * 2.399963, offset = 20 + i % 45
    result[i].x = center.x / center.count + Math.cos(angle) * offset
    result[i].y = center.y / center.count + Math.sin(angle) * offset
  }
  return result
}
