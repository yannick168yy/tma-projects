import type { CapacitorConfig } from '@capacitor/cli'

const appId = process.env.CAP_APP_ID?.trim() || 'games.betogo.app'
// 租户包由 scripts/build-tenant-apk.sh 传入；自营包不传，取默认值，产物与改造前一致
const appName = process.env.CAP_APP_NAME?.trim() || 'BETOGO'
const backgroundColor = process.env.CAP_BACKGROUND?.trim() || '#080b14'
const allowedDomains = (process.env.CAP_ALLOWED_DOMAINS
  || 'www.188facai.com,188facai.com,www.betogo.games,betogo.games,*.betogo.games,betogo666.com,*.betogo666.com,betogo777.com,*.betogo777.com,betogo.ph,*.betogo.ph,betogo.xyz,*.betogo.xyz,betogo.vip,*.betogo.vip,betogo888.com,*.betogo888.com,betogo.cc,*.betogo.cc,betogo.app,*.betogo.app')
  .split(',').map((domain) => domain.trim()).filter(Boolean)

// 远程 URL 模式：APK 只是壳，页面全部走线上站点。
// 前端改动照常 deploy 到服务器即可，用户重开 App 就是最新版，无需重发包。
// 只有域名列表 / 原生权限 / targetSdk 变更才需要重新出包。
const config: CapacitorConfig = {
  appId,
  appName,
  webDir: 'www',
  // WebView 底色：原生启动屏结束到页面渲染之间的空档显示深色而非白屏
  backgroundColor,
  plugins: {
    // Android 12+ 系统启动屏强制"居中图标"样式，全屏宣传图只在 ≤11 生效——
    // 所以品牌启动图改由 web 层实现（App.tsx BootSplash，2.5s），全版本一致且换图免发包。
    // 原生启动屏只保留一瞬（深色底），避免与 web 启动图叠加成双倍等待。
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor,
      androidScaleType: 'CENTER_CROP',
    },
  },
  android: {
    // 后端可用 UA 里的 BetogoApp/<ver> 识别 App 用户，做归因与「已安装」判定。
    // 租户包**刻意不改这个标记**：它是站点判定「是否装了 App」的协议约定，不是品牌文案，
    // 每个租户换一个标记就要在前端加一张对照表，收益为零（同 P1-12 对 betogo_token 的处理）
    appendUserAgent: 'BetogoApp/0.1.0',
    allowMixedContent: false,
  },
  server: {
    // 不再写死远程 server.url。App 先加载包内启动页，再由原生线路选择器并行探活并进入主站。
    androidScheme: 'https',
    cleartext: false,
    // 只放自己的域名。支付网关与 Google/Telegram 授权页刻意排除在外：
    // MainActivity 会把它们送进 Custom Tab —— 留在 App 内、可返回、轮询不中断。
    // Turnstile 和游戏都是 iframe 加载，不受 allowNavigation（只管顶层导航）影响。
    allowNavigation: allowedDomains,
  },
}

export default config
