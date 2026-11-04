import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { applicationTheme } from './styles/primeVueTheme'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'

import App from './App.vue'
import router from './router'

import 'primeicons/primeicons.css'
import './styles/global.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: applicationTheme,
    options: { darkModeSelector: false },
  },
})
app.use(ToastService)
app.use(ConfirmationService)

app.mount('#app')


