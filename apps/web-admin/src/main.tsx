import '@ant-design/v5-patch-for-react-19'
import { SITE_TITLE } from './site'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './responsive.css'
import App from './App'

// index.html 里的 <title> 是静态的，演示站要在运行时改掉
document.title = SITE_TITLE

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} pagination={{ showSizeChanger: true }} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <App />
    </ConfigProvider>
  </StrictMode>,
)
