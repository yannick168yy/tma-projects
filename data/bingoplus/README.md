# bingoplus 竞品数据（头部信号级）

## 抓取现状
bingoplus.com 是 Vue3 SPA + Cloudflare。游戏接口 **匿名可访问**（`/_glaxy_c66_/` 前缀），但**全量游戏详情藏在 hash 资源包**（siteinfo 的 `GAME_JSON=<hash>` 是资源指纹，实际数据在懒加载 chunk / resourceBit 机制里），深挖成本高。

## 决策：收口为头部信号
bingoplus 原定角色 = 方图封面第二来源 + 市占第三信号。这两个角色已被 **ptgaming 超额覆盖**（3807 款统一 310×314 方图 + 市占第二信号），故 bingoplus 全量详情降级为后续可选，本轮仅保留已匿名捕获的头部信号。

## 已捕获数据
- `channelPage.json` — 25 个首页频道栏目结构（曝光位版型信息）。canvasStyle 确认 **540×540 方图、3行3列**（版型与我方卡片一致）。频道：GamePerya/GameLoteria/GameArcade/GameCasino/GameCards/GameSlot/Cards/Sports/Loteria/Arcade/Casino/Poker/Perya/Slot/Hot/Bingo/Fishing 等
- `topRankingGame.json` — Big Win 榜单 13 款（完整字段：gameName/gameImage(540×540 webp)/gameKind/platformName/rank/amount）
- `gameIndex.json` — `userNeedCheckGames` 全量索引 1369 条（仅 gameId+platformId，无名称/图片）

## ✅ 全量已抓完（2026-07-05）
`queryContentList` 匿名版每组只回 1 款引流游戏；真正全量在一份**免签静态 JS 目录**
`/staticJs/game/game_bp_h5_1_1000_<gameKey>.js`（gameKey 由签名接口 getGameKey 下发）。
爬虫见 `scripts/bingoplus-crawler/`（build.mjs 取 key+拉目录，download_images.mjs 下图）。
产出 `games.json`/`games.csv`（2728 款）+ `images/`（2728 张 540 方图，88MB，gitignore）。

## 图片规格
`/externals/C66FM/img/_wms/_l/electronicgames/<platform>/<code>540x540.webp`，防盗链需带 Referer。
