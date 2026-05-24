import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n } from '@/i18n'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'
import { initTelegramWebApp } from '@/utils/initTelegramWebApp'

preventDoubleTapZoom()
initTelegramWebApp()

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.mount('#app')
