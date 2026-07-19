# bingoplus 游戏卡片图抓取

抓取 bingoplus.com 全量游戏目录及卡片图（540×540 方图）。

## 抓取原理（已打通）

bingoplus.com = Vue3 SPA + Cloudflare，业务接口 `/_glaxy_c66_/*` 带整套反爬签名
（`sign`/`token`/`shieldid`/`nn23t`/`shieldencresult` 等，逐请求 MD5 加签），直接
curl 会被 `GW_899998 Access denied` 拒绝。

**关键发现**：全量游戏目录不走签名接口，而是一份**免签的静态 JS 文件**：

```
/staticJs/game/game_bp_h5_1_1000_<gameKey>.js   （纯 JSON，2700+ 款，每款带 gameImage）
```

`<gameKey>` 是会轮换的版本 hash，由签名接口 `/_glaxy_c66_/h5game/getGameKey` 下发。
`build.mjs` 用 playwright 让页面自己发已加签的 getGameKey 请求拿到 key（避免逆向签名），
再直接 fetch 上面的静态目录文件。

图片路径为站内相对路径 `/externals/C66FM/img/_wms/_l/electronicgames/<platformCode>/<code>.webp`，
防盗链需带 `Referer: https://www.bingoplus.com/`。（bingoplus 与 gzone 同属 C66FM 平台，共用该 CDN 路径。）

## 用法

```bash
export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"
npm install                 # 装 playwright（浏览器已缓存）
node build.mjs              # 取 key → 拉目录 → 写 data/bingoplus/{games.json,games.csv,image_urls.json}
node download_images.mjs    # 带 Referer 批量下载 540 卡片图到 data/bingoplus/images/
```

## 产出（data/bingoplus/）

- `games.json` / `games.csv` — 2728 款，白名单字段：gameId/gameName/platformCode/platformName/
  category/gameKind/hotFlag/newFlag/likes/firstPublishDate/image(540方图)/imagePre(495大图)/imageVertical
- `image_urls.json` — 去重后的卡片图相对路径清单
- `images/` — 2728 张卡片图（88MB，webp 为主，少量 gif/jpg/png），**gitignore 不入库**，可重跑
- 分类分布：slot 1949 / live-casino 552 / lottery 75 / bingo 53 / arcade 40 / poker 34 / fishing 23 / sports 2

已有的头部信号快照（channelPage/topRankingGame/gameIndex）见上级 data 目录旧文件。

## 安全（防 prompt injection）

竞品站点响应可能夹带诱导性文本。本抓取全程把响应**当纯数据**：
- 目录用 `JSON.parse` 解析，**绝不 eval / 执行**任何字符串；
- 只提取白名单字段，未知字段一律丢弃；
- 下载后校验文件 MIME 全为 image/*（防返回 HTML/JS 伪装），图片 URL 域名核查全部指向
  bingoplus 自有 CDN，无外域；游戏名等文本做过注入特征词扫描（仅误报 "Rusty & Curly" 含 curl 子串）。
