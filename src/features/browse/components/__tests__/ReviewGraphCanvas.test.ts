import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewGraphCanvas from '../ReviewGraphCanvas.vue'

let resizeCallback: ResizeObserverCallback
let width = 800
const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), arc: vi.fn(), fill: vi.fn() }
const elements = [
  { data: { id: 'subject:a', iri: 'urn:a', label: 'A', color: '#248b68', type: 'Building', kind: 'subject' }, position: { x: 0, y: 0 } },
  { data: { id: 'subject:b', iri: 'urn:b', label: 'B', color: '#8970b6', type: 'Organization', kind: 'subject' }, position: { x: 200, y: 100 } },
  { data: { id: 'edge:1', source: 'subject:a', target: 'subject:b' } },
]
const props = { elements, visibleIris: ['urn:a', 'urn:b'], mode: 'type' as const, labels: false }

beforeEach(() => {
  width = 800
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 10, y: 20, left: 10, top: 20, width, height: 550, bottom: 570, right: width + 10, toJSON() {} }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ReviewGraphCanvas', () => {
  it('deselects on an empty canvas click, while panning and entity clicks preserve selection', async () => {
    const wrapper = mount(ReviewGraphCanvas, { props: { ...props, selectedIri: 'urn:a' } })
    const canvas = wrapper.find('canvas')
    canvas.element.setPointerCapture = vi.fn()
    canvas.element.hasPointerCapture = vi.fn(() => true)
    canvas.element.releasePointerCapture = vi.fn()
    const pointer = { pointerId: 1, button: 0, clientX: 20, clientY: 30 }
    await canvas.trigger('pointerdown', pointer)
    await canvas.trigger('pointerup', pointer)
    expect(wrapper.emitted('deselect')).toHaveLength(1)

    // Initial fit puts the first entity at local (200, 190), with the canvas at (10, 20).
    const entityPointer = { ...pointer, clientX: 210, clientY: 210 }
    await canvas.trigger('pointerdown', entityPointer)
    await canvas.trigger('pointerup', entityPointer)
    expect(wrapper.emitted('openSubject')).toEqual([['urn:a']])
    expect(wrapper.emitted('deselect')).toHaveLength(1)

    await canvas.trigger('pointerdown', pointer)
    await canvas.trigger('pointermove', { ...pointer, clientX: 100, clientY: 90 })
    await canvas.trigger('pointerup', { ...pointer, clientX: 100, clientY: 90 })
    expect(wrapper.emitted('deselect')).toHaveLength(1)
    wrapper.unmount()
  })

  it('preserves the viewport through layout, labels, filters and resize, fitting only on request', async () => {
    const wrapper = mount(ReviewGraphCanvas, { props })
    wrapper.vm.zoom(1.25)
    const events = wrapper.emitted('zoomChange')!.length
    const zoom = wrapper.emitted('zoomChange')!.at(-1)
    await wrapper.setProps({ mode: 'network', labels: true, visibleIris: ['urn:a'] })
    width = 1000
    resizeCallback([], {} as ResizeObserver)
    expect(wrapper.emitted('zoomChange')).toHaveLength(events)
    expect(wrapper.emitted('zoomChange')!.at(-1)).toEqual(zoom)
    wrapper.vm.fit()
    expect(wrapper.emitted('zoomChange')).toHaveLength(events + 1)
    wrapper.unmount()
  })

  it('handles wheel zoom locally and prevents page scrolling', () => {
    const wrapper = mount(ReviewGraphCanvas, { props })
    const previous = Number(wrapper.emitted('zoomChange')!.at(-1)![0])
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: 210, clientY: 170, cancelable: true })
    wrapper.find('canvas').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(Number(wrapper.emitted('zoomChange')!.at(-1)![0])).toBeGreaterThan(previous)
    expect(wrapper.emitted('openSubject')).toBeUndefined()
    wrapper.unmount()
  })
})
