export interface GraphViewport { x: number; y: number; scale: number }

/** Keep the world position beneath the pointer fixed, including at zoom limits. */
export function zoomGraphAt(view: GraphViewport, factor: number, x: number, y: number): GraphViewport {
  const scale = Math.max(0.02, Math.min(8, view.scale * factor))
  const ratio = scale / view.scale
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio }
}

export function resizeGraphViewport(view: GraphViewport, widthDelta: number, heightDelta: number): GraphViewport {
  return { ...view, x: view.x + widthDelta / 2, y: view.y + heightDelta / 2 }
}
