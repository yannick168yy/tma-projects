import type { CapacitorConfig } from '@capacitor/cli'

// 远程 URL 模式：APK 只是壳，页面全部走线上站点。
// 前端改动照常 deploy 到服务器即可，用户重开 App 就是最新版，无需重发包。
// 只有域名列表 / 原生权限 / targetSdk 变更才需要重新出包。
const config: CapacitorConfig = {
  appId: 'games.betogo.app',
  appName: 'BETOGO',
  webDir: 'www',
  // WebView 底色：原生启动屏结束到页面渲染之间的空档显示深色而非白屏
  backgroundColor: '#080b14',
  plugins: {
    // Android 12+ 系统启动屏强制"居中图标"样式，全屏宣传图只在 ≤11 生效——
    // 所以品牌启动图改由 web 层实现（App.tsx BootSplash，2.5s），全版本一致且换图免发包。
    // 原生启动屏只保留一瞬（深色底），避免与 web 启动图叠加成双倍等待。
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor: '#080b14',
      androidScaleType: 'CENTER_CROP',
    },
  },
  android: {
    // 后端可用 UA 里的 BetogoApp/<ver> 识别 App 用户，做归因与「已安装」判定
    appendUserAgent: 'BetogoApp/0.1.0',
    allowMixedContent: false,
  },
  server: {
    // 入口域名按环境变量切：出生产包 CAP_SERVER_URL=https://www.betogo.games npx cap sync android
    // 后再 assembleRelease；不设则默认测试站。两个域名各出各的包，其余配置共用。
    url: process.env.CAP_SERVER_URL || 'https://www.188facai.com',
    androidScheme: 'https',
    cleartext: false,
    // 只放自己的域名。支付网关与 Google/Telegram 授权页刻意排除在外：
    // MainActivity 会把它们送进 Custom Tab —— 留在 App 内、可返回、轮询不中断。
    // Turnstile 和游戏都是 iframe 加载，不受 allowNavigation（只管顶层导航）影响。
    allowNavigation: [
      'www.188facai.com',
      '188facai.com',
      'www.betogo.games',
      'betogo.games',
      '*.betogo.games',
      'betogo.app',
      '*.betogo.app',
    ],
  },
}

export default config
