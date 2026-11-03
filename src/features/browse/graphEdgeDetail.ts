/** Thin overview connections at low zoom; highlighted connections are drawn separately. */
export function graphEdgeDetail(scale: number, mode: 'type' | 'network', edgeCount: number) {
  if (mode === 'network') return { stride: 1, opacity: 0.18 }
  const budget = Math.max(160, Math.round(1800 * scale * scale))
  return { stride: Math.max(1, Math.ceil(edgeCount / budget)), opacity: Math.max(0.025, Math.min(0.2, scale * 0.12)) }
}
