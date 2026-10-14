import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EnrichNode from '@/features/mapping/components/canvas/EnrichNode.vue'
import EnrichmentLookupWarnings from '@/features/mapping/components/EnrichmentLookupWarnings.vue'

const stubs = {
  Handle: true,
  Button: true,
  Message: { template: '<div role="alert"><slot /></div>' },
}

describe('enrichment lookup warnings', () => {
  it('shows the input and error details without opening the node configuration', async () => {
    const onOpenConfig = vi.fn()
    const data = {
      title: 'GeoNames', subtitle: 'demo', icon: 'pi pi-map-marker', inputHandleId: 'geo-input', inputLabel: 'IDs',
      status: 'success' as const, processedCount: 2, totalCount: 2, cachedCount: 0, outputs: [], actionLabel: 'Refresh',
      footerNote: '', lookupErrors: [{ input: 'Unknown place', message: 'No match found' }], onOpenConfig,
    }
    const wrapper = mount(EnrichNode, { props: { data }, global: { stubs } })

    expect(wrapper.text()).toContain('completed with warnings')
    expect(wrapper.text()).toContain('1 lookup(s) failed. Output is empty for these entries.')
    expect(wrapper.find('li').text()).toContain('Unknown place: No match found')
    await wrapper.find('summary').trigger('click')
    expect(onOpenConfig).not.toHaveBeenCalled()

    await wrapper.setProps({ data: { ...data, lookupErrors: [] } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('completed with warnings')
  })

  it('does not render warnings for successful runs or old projects without errors', () => {
    const wrapper = mount(EnrichmentLookupWarnings, { props: { errors: [] }, global: { stubs } })
    expect(wrapper.find('details').exists()).toBe(false)
  })
})
