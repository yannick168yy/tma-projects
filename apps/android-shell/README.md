# BETOGO Android 壳（Capacitor）— 可行性验证报告

验证日期：2026-07-24
验证环境：Android 13 (API 33) 模拟器，WebView Chrome 109，壳指向测试站 www.188facai.com

## 结论：可行

APK 3.9 MB，首次构建 2 分 30 秒。全站在 Android WebView 里**完整渲染**，
首页轮播、游戏封面、底部导航、登录弹窗均正常，没有出现 iOS PWA 上那种白屏闪退。

## 实测通过项

| 项目 | 结果 |
|---|---|
| 站点整体渲染 | 正常，与手机浏览器一致 |
| UA 注入 | `...Mobile Safari/537.36 BetogoApp/0.1.0`，后端可据此识别 App 用户 |
| localStorage / cookie | 可用且持久 |
| ServiceWorker | 可注册 |
| Turnstile 脚本加载 | `LOADED`（iOS PWA 的崩溃问题在 Android WebView 未复现） |
| 登录弹窗 | 完整渲染，无白屏 |
| 白名单外域名跳转 | 正确唤起系统浏览器，App 保留在后台 |

## 必须修复的问题

### 1. 充值跳转会覆盖整个 App（阻断级）

`WalletModal.tsx` 用 `window.open(payUrl,'_blank')` 打开支付页，之后 `setInterval` 轮询订单状态。

实测 WebView 行为：
- payUrl 域名**在** `allowNavigation` 白名单 → 在同一 WebView 里**整页跳走**，原页面销毁，
  轮询中断，且壳没有导航栏，用户支付完**无法返回，只能杀进程重开**
- payUrl 域名**不在**白名单 → 唤起系统浏览器（App 保留，轮询继续）

修法：支付网关域名**不要**加入 `allowNavigation`；更好的做法是用 `@capacitor/browser`
以 Custom Tab 打开，支付完可返回 App，轮询不中断。

### 2. Google 登录在 App 内走不通（阻断级）

`googleOAuth.ts` 用 `location.href` 跳 accounts.google.com。实测跳到系统 Chrome，
用户在浏览器里完成登录，回调也落在浏览器 —— **App 里的 WebView 拿不到登录态**。
（Google 自 2021 起也主动拒绝 WebView 内登录。）

修法：接原生 Google 登录插件，或 Custom Tab + deeplink 回跳 App。
Telegram 登录同理需要单独验证。

### 3. 返回键直接退出 App

实测在首页按硬件返回键 → 直接回桌面。WebView 无历史时 Capacitor 默认退出 Activity，
用户任何页面误触都会掉出去。

修法：拦截 `backButton`，映射到站内路由返回；根路由做「再按一次退出」。

### 4. App 内仍显示「Download Our APP」横幅

`isStandalone()` 在壳里返回 `false`（不是 PWA 模式），站点把 App 用户当成普通浏览器用户，
顶部仍推下载横幅，`DownloadPage` 的「已安装」判断也会失效。

修法：站点改用 UA 里的 `BetogoApp` 标识判断，命中则隐藏所有下载引导。

## 本地验证环境的两个坑

- **Tailscale 会让模拟器 DNS 全挂**：emulator 把 host-dns 取成 `100.64.100.1`（Tailscale DNS），
  模拟器内路由不到，表现为 `ERR_NAME_NOT_RESOLVED`，`-dns-server` 参数也覆盖不掉。
  解法：`-writable-system` 启动 → `adb root && adb disable-verity && adb reboot && adb remount`
  → 往 `/etc/hosts` 写 `47.84.34.139 www.188facai.com`。真机无此问题。
- **Intel Mac 带窗口启动 GPU 会崩**（`Failed to bind to post worker context`），用 `-no-window`，
  截图照样能用 `adb exec-out screencap` 拿。

## 构建

```bash
# SDK 环境（一次性）
brew install --cask android-commandlinetools
sdkmanager --sdk_root=/usr/local/share/android-commandlinetools "platform-tools" "platforms;android-35" "build-tools;35.0.0"

# 出包
cd apps/android-shell && npx cap sync android
cd android && ./gradlew assembleDebug   # 产物：app/build/outputs/apk/debug/app-debug.apk
```

## 更新机制

远程 URL 模式：前端照常部署到服务器，用户重开 App 即最新版，**无需重发 APK**。
只有域名列表、原生权限、targetSdk 变更才需要重新出包。
