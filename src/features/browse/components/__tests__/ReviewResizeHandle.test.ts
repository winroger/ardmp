import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewResizeHandle from '../ReviewResizeHandle.vue'

describe('Review sidebar resizing', () => {
  it.each([
    { reverse: false, value: 260, expected: 360 },
    { reverse: true, value: 390, expected: 290 },
  ])('resizes in the correct direction and clamps pointer movement: $reverse', async ({ reverse, value, expected }) => {
    const wrapper = mount(ReviewResizeHandle, { props: { label: 'Resize panel', value, min: 180, max: 500, defaultValue: 260, reverse } })
    const element = wrapper.element as HTMLElement
    element.setPointerCapture = vi.fn()
    element.hasPointerCapture = vi.fn(() => true)
    element.releasePointerCapture = vi.fn()
    await wrapper.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 400 })
    await wrapper.trigger('pointermove', { pointerId: 2, clientX: 900 })
    expect(wrapper.emitted('update:value')).toBeUndefined()
    await wrapper.trigger('pointermove', { pointerId: 1, clientX: 500 })
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([expected])
    await wrapper.trigger('pointermove', { pointerId: 1, clientX: 4000 })
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([reverse ? 180 : 500])
    await wrapper.trigger('pointerup', { pointerId: 1 })
    expect(element.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(wrapper.classes()).not.toContain('is-dragging')
    wrapper.unmount()
  })

  it('supports keyboard resizing, limits and resetting to the default width', async () => {
    const wrapper = mount(ReviewResizeHandle, { props: { label: 'Resize details', value: 390, min: 280, max: 600, defaultValue: 390, reverse: true } })
    await wrapper.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([430])
    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([380])
    await wrapper.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([280])
    await wrapper.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([600])
    await wrapper.trigger('dblclick')
    expect(wrapper.emitted('update:value')!.at(-1)).toEqual([390])
    expect(wrapper.attributes('aria-orientation')).toBe('vertical')
    wrapper.unmount()
  })
})
