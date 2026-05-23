# bff-node

Node.js (Koa) BFF：Telegram `initData` 校验、Redis Session、用户/游戏/分销；代理 Core 只读接口。

- 无状态，Session 仅存 Redis。
- 目录约定见 [docs/STRUCTURE.md](../../docs/STRUCTURE.md)。

下一步：初始化 `package.json`，安装 `koa`、`ioredis`、`@tma.js/init-data-node`（或自实现 HMAC）。
