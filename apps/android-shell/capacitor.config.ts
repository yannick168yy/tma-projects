import type { CapacitorConfig } from '@capacitor/cli'

// 远程 URL 模式：APK 只是壳，页面全部走线上站点。
// 前端改动照常 deploy 到服务器即可，用户重开 App 就是最新版，无需重发包。
// 只有域名列表 / 原生权限 / targetSdk 变更才需要重新出包。
const config: CapacitorConfig = {
  appId: 'games.betogo.app',
  appName: 'BETOGO',
  webDir: 'www',
  android: {
    // 后端可用 UA 里的 BetogoApp/<ver> 识别 App 用户，做归因与「已安装」判定
    appendUserAgent: 'BetogoApp/0.1.0',
    allowMixedContent: false,
  },
  server: {
    // 可行性验证先直连测试站；正式版改为由 www/index.html 探活后跳转
    url: 'https://www.188facai.com',
    androidScheme: 'https',
    cleartext: false,
    // WebView 内允许停留的域名（不走系统浏览器）。支付/OAuth 外跳域名要在这里放行
    allowNavigation: [
      'www.188facai.com',
      '188facai.com',
      'www.betogo.games',
      'betogo.games',
      '*.betogo.games',
      'challenges.cloudflare.com',
      'oauth.telegram.org',
      '*.568win.com',
    ],
  },
}

export default config
