import type { CapacitorConfig } from '@capacitor/cli'

// 远程 URL 模式：APK 只是壳，页面全部走线上站点。
// 前端改动照常 deploy 到服务器即可，用户重开 App 就是最新版，无需重发包。
// 只有域名列表 / 原生权限 / targetSdk 变更才需要重新出包。
const config: CapacitorConfig = {
  appId: 'games.betogo.app',
  appName: 'BETOGO',
  webDir: 'www',
  plugins: {
    // 启动屏固定停留 2.5s：品牌曝光与冷启动体感的平衡点（下次重打包生效）
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: '#080b14',
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
