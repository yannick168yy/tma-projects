# bingoplus 竞品数据（头部信号级）

## 抓取现状
bingoplus.com 是 Vue3 SPA + Cloudflare。游戏接口 **匿名可访问**（`/_glaxy_c66_/` 前缀），但**全量游戏详情藏在 hash 资源包**（siteinfo 的 `GAME_JSON=<hash>` 是资源指纹，实际数据在懒加载 chunk / resourceBit 机制里），深挖成本高。

## 决策：收口为头部信号
bingoplus 原定角色 = 方图封面第二来源 + 市占第三信号。这两个角色已被 **ptgaming 超额覆盖**（3807 款统一 310×314 方图 + 市占第二信号），故 bingoplus 全量详情降级为后续可选，本轮仅保留已匿名捕获的头部信号。

## 已捕获数据
- `channelPage.json` — 25 个首页频道栏目结构（曝光位版型信息）。canvasStyle 确认 **540×540 方图、3行3列**（版型与我方卡片一致）。频道：GamePerya/GameLoteria/GameArcade/GameCasino/GameCards/GameSlot/Cards/Sports/Loteria/Arcade/Casino/Poker/Perya/Slot/Hot/Bingo/Fishing 等
- `topRankingGame.json` — Big Win 榜单 13 款（完整字段：gameName/gameImage(540×540 webp)/gameKind/platformName/rank/amount）
- `gameIndex.json` — `userNeedCheckGames` 全量索引 1369 条（仅 gameId+platformId，无名称/图片）

## 后续如需 bingoplus 全量
按 `getChannelPage` 的 subChannel 逐个调 `/_glaxy_c66_/activity/multipleContent/queryContentList` 展开各频道游戏卡（含 gameName/image/顺序 = 曝光位），或逆向 resourceBit hash 资源包 URL。接口清单见 scripts/（本目录暂无独立爬虫，数据由 playwright 探测捕获）。

## 图片规格
`/externals/C66FM/img/_wms/_l/electronicgames/<platform>/<code>540x540.webp`，防盗链需带 Referer。
