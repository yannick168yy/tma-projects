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

## 封面补图到 568Win（match_covers.mjs）
按「厂商映射 + 归一化游戏名」把 gzone 封面匹配到 `bg_568win_game`，产出：
- `cover_matches.json` — 匹配明细
- `upload_list.txt` — 待上传图片清单（tar/rsync 到服务器 `data/kyc/covers/gzone/`）
- `gzone_covers.sql` — 写 `bg_568win_game_override.image_override`（**手动执行，不进迁移**），
  URL 形如 `/api/v1/home/images/covers/gzone/<file>.webp`（公开图片路由已放行 covers/ 前缀）

2026-07-04 首次执行：命中 1659 款 gzone 游戏 → 覆盖我方 1670 款（JILI 209、PP 208、EVOLUTION 181、PG 145、CQ9 129、HACKSAW 95、PLAYSTAR 88…）。
需要先跑爬虫更新 data/gzone 后再复跑本脚本（需本地 win568_games.tsv，从库里 SELECT 导出）。
