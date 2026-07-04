# gzone.ph 游戏数据爬虫

抓取 https://gzone.ph/all 的全部游戏（名称、厂商、封面图）。

## 原理
gzone.ph 是 Vue SPA，游戏数据不在 HTML 里，而是从带版本哈希的静态 JS 加载：
- `staticJs/gpgame/GAME_BASE_ALL_INFO_<hash>.js` — 全部游戏信息（名称/厂商/状态）
- `staticJs/gpgame/GAME_BASE_ALL_IMG_<hash>.js` — 游戏 id → 封面图 URL（pub.imgscache.com）
- `staticJs/gpgame/productPlatformConfig_<hash>.js` — 厂商配置

哈希版本号由站点 siteinfo 下发、随时会变，所以用 Playwright 加载页面监听网络请求截获，
不硬编码 URL。

## 用法
```bash
# 需要 playwright（npm i playwright && npx playwright install chromium）
node crawl_gzone.mjs ./gzone_capture          # 1. 无头浏览器截获数据 JS
node merge_and_download.mjs ../../data/gzone  # 2. 合并 + 下载全部封面图
```

## 产出（data/gzone/）
- `games.json` / `games.csv` — 2779 个游戏：id、gameId、名称、厂商、图片 URL、本地文件名
- `images/` — 封面图 webp，命名 `厂商__游戏名__id.webp`（已 gitignore，不入库）
