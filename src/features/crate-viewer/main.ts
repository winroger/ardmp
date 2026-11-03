import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import CrateViewerApp from './CrateViewerApp.vue'
import type { CrateViewerPayload } from './types'
import '@/styles/global.scss'
import 'primeicons/primeicons.css'

try {
  const element = document.getElementById('ardmp-viewer-data')
  if (!element?.textContent) throw new Error('Dataset viewer data is missing.')
  const payload = JSON.parse(element.textContent) as CrateViewerPayload
  if (payload.version !== 1) throw new Error('Unsupported dataset viewer version.')
  const app = createApp(CrateViewerApp, { payload })
  app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.viewer-dark' } } })
  app.use(ToastService)
  app.mount('#ardmp-crate-viewer')
  // Dataset IRIs are data, not executable navigation targets.
  document.addEventListener('click', event => {
    const anchor = (event.target as Element | null)?.closest('a')
    if (anchor && /^(?:javascript|vbscript|data):/i.test(anchor.getAttribute('href')?.trim() ?? '')) event.preventDefault()
  }, true)
} catch (cause) {
  const host = document.getElementById('ardmp-crate-viewer')
  if (host) host.textContent = `The interactive viewer could not start: ${cause instanceof Error ? cause.message : String(cause)}. The dataset files remain available through the links above.`
}
