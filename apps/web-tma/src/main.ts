import { createApp } from 'vue'
import App from './App.vue'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'

preventDoubleTapZoom()

createApp(App).mount('#app')
