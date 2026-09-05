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

## 四个问题已修复并复测通过（2026-07-24）

修复全部落在壳侧（`MainActivity.java`），站点代码只动了「是否已装 App」的判定 ——
同一份 bundle 还要服务 H5/PWA/Telegram，不该为 App 特化。

| 问题 | 修法 | 复测结果 |
|---|---|---|
| 充值整页覆盖 App | 外部链接走 Custom Tab；开 `setSupportMultipleWindows` + `onCreateWindow` 接住 `window.open` | 触发后 WebView 仍停在 `/home`，原页面和轮询都活着 |
| Google 登录态回不来 | OAuth 回跳路径注册成 App Link + `assetlinks.json` | `pm get-app-links` 显示 `www.188facai.com: verified`，回跳 intent 正确路由回 App 并加载 callback URL |
| 返回键直接退出 | 映射到站内路由；首页「2 秒内再按一次退出」 | 二级页返回回上一页且不退出；首页连按两次才退出 |
| App 内仍推下载横幅 | 站点用 UA 里的 `BetogoApp` 判定（`isNativeApp`/`isInstalledApp`/`installSource`） | 横幅已消失；下载礼金按 `apk` 来源上报 |

`shouldOverrideUrlLoading` 里必须判 `isForMainFrame` —— 游戏是跨域 iframe 加载的，
不判会把整个游戏踢到浏览器。

### 包网租户出包（P1-15，2026-09-05）

自营的 `ph` / `id` 两个 flavor 原样保留（已发布，不能动）。新增一个 `tenant` flavor，
包名、桌面名、线路组、TG 旁路频道、启动屏底色、版本号、图标、签名全部走 `-P` 参数，
**接一个客户不需要再改 build.gradle**。

```bash
# 参数从平台库 pf_tenant_app 读，出包在本机跑
DEPLOY_HOST=root@47.84.34.139 \
SSH_IDENTITY_FILE=/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/aliyun.pem \
bash scripts/build-tenant-apk.sh <租户代号> --market PH --icon ~/acme-1024.png
```

- 参数在平台控制台「租户详情 → App 出包」维护
- **签名密钥不进平台库**：库里只有一个引用名，密钥文件放出包机的
  `android/keystore-<引用名>.properties`（已 gitignore）。密钥丢了就再也无法更新已发布的 App
- 图标传一张 1024×1024 PNG，脚本用 `sips` 生成五档 mipmap，放进临时目录后以
  `-PtenantResDir` 传给 gradle（不覆盖仓库里的默认图标）
- 启动图仍在 web 层（`App.tsx` BootSplash），换图免发包；这里只有原生那一瞬的底色
- UA 标记 `BetogoApp/<ver>` **所有租户共用**：它是站点判定"是否装了 App"的协议约定，
  不是品牌文案，每租户换一个只会让前端多一张对照表
- 构建期护栏：租户 release 缺签名密钥、缺线路组、缺线路验签公钥都直接失败 ——
  这三种包发出去都是废包

实测（2026-09-05）：`assembleTenantDebug` 出包成功，`aapt dump badging` 显示
`games.demo1.app / versionCode 3 / versionName 1.0.2 / label DEMO1`，BuildConfig 里
`APP_MARKET=PH`、`APP_DOMAINS=demo1.example.com`；回归 `assemblePhDebug` 仍是
`games.betogo.app / 11 / 1.0.10 / BETOGO`，自营包零变化。

### 签名与 App Link（2026-07-24 已完成）

- **正式签名密钥**：`TMA_FILES/亚马逊云-阿里云/betogo-release.jks`，alias `betogo`，
  密码在同目录的 `betogo-release-keystore-密码.txt`。**不可更换** —— 丢了就再也无法更新已发布的 App。
  gradle 从 `android/keystore.properties`（已 gitignore）读路径和密码；该文件必须按 UTF-8 解析，
  因为密钥路径含中文目录，Java Properties 默认 ISO-8859-1 会把路径读成乱码。
- **assetlinks.json 同时带 release + debug 两个指纹**，内测包和正式包都验得过。
  已部署测试站与生产（`https://www.betogo.games/.well-known/assetlinks.json` → 200 `application/json`），
  Google 官方验证器 `digitalassetlinks.googleapis.com` 已能解析出两条 statement。
- **只注册 www 域名**：裸域 `betogo.games` 是 301 到 www，而 App Link 验证不跟随重定向，
  注册了也永远验不过。流量本来就全规范化到 www。

### 还没做的

- **真机复测 Custom Tab 外观**：模拟器的 Chrome 停在首次运行页，看不到 Custom Tab 的真实样子。
- **未实测**：KYC 图片上传、游戏 iframe 加载（都需要登录态）。
  前者靠 `BridgeWebChromeClient` 自带的 `onShowFileChooser`（我们只覆盖了 `onCreateWindow`，它保留着）；
  后者靠上面的 `isForMainFrame` 判断。两条路径都在代码里成立，但没跑过真实流程。

## 原始验证发现的问题（已修，保留记录）

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

### 菲律宾与印尼独立包

- 菲律宾：包名 `games.betogo.app`，内置 `betogo.games / betogo666.com / betogo777.com`，构建命令 `npm run apk:ph:release`。
- 印尼：包名 `games.betogo.id`，内置 `betogo.app / betogo.xyz / betogo.vip`，构建命令 `npm run apk:id:release`。
- App 不再写死 `server.url`：启动时并行请求 `/api/v1/app/bootstrap`，上次线路健康则继续使用，失败时切到响应最快的备用域名。
- 后台“系统设置 → 站点域名映射”可调整每个市场的 App 域名组、启停和优先级；APK 只接受构建时白名单内的域名。
- 登录 token 会同步保存到 Android Keystore；切换域名后新 origin 可恢复会话，不通过 URL 传递 token。
- 两个产品变体可同时安装；印尼签名读取 `android/keystore-id.properties`，不会复用或覆盖菲律宾签名。
- 两个域名组里的每个域名都必须部署同时包含 `games.betogo.app` 与 `games.betogo.id` 指纹的
  `/.well-known/assetlinks.json`，并在 Manifest 注册 `/auth/*` App Link。
- `assetlinks/www.betogo.games.json` 是已合并旧包与印尼新包的生产候选文件；部署时不能只保留
  新包 statement，否则会让现有 `games.betogo.app` 的 App Link 失效。
- 首次生成印尼独立签名：`bash scripts/generate-id-signing.sh <站外安全备份目录>`。脚本拒绝覆盖
  已存在的签名，并在本地生成 gitignore 的 `android/keystore-id.properties`。

## 更新机制

线路选择完成后仍加载线上前端，日常页面更新无需重发 APK。APK 白名单、原生权限、会话插件或
targetSdk 变更时才需要重新出包。
