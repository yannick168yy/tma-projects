import { createApp } from 'vue'
import App from './App.vue'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'
import { initTelegramWebApp } from '@/utils/initTelegramWebApp'

preventDoubleTapZoom()
initTelegramWebApp()

createApp(App).mount('#app')
