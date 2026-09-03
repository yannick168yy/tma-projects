# 包网工程 · 完整工作列表（WBS）

> 配套方案：`04-whitelabel-multitenant.md`
> 分支：`feature/whitelabel-multitenant`
> 人天为粗估（单人、含自测，不含需求反复与三方联调波动）

## 总览

| 阶段 | 目标 | 任务数 | 粗估 |
|---|---|---|---|
| P0 租户化地基 ✅ **已完成** | 对外零变化，系统具备多租户能力 | 11 | ~29 人天 |
| P1 开站与平台后台 | 能开出第二个站，定制化第一批交付 | 15 | ~44 人天 |
| P2 商务闭环 | 双资金模式 + 四种分成 + 账单结算 | 12 | ~38 人天 |
| P3 定制化深化与生态 | 区块化、overlay、自助、风控联防 | 8 | ~40 人天 |
| X 贯穿项 | 安全、运维、文档 | 5 | ~10 人天 |
| 合计 | | 51 | ~161 人天 |

---

## P0 租户化地基（对外零变化）

> 完成标志：线上功能表现与今天完全一致，但系统内部已按租户隔离，随时可开第二个库。

### P0-1 平台库与独立迁移体系 · 2d ✅ 已完成 2026-09-02
- 新建 `infra/database/platform/001_init.sql`：`pf_tenant`、`pf_tenant_domain`、`pf_tenant_market`
- 平台库使用独立的 `schema_migrations`，与租户库迁移目录彻底分开
- 自营站登记为 tenant #1，`database` 字段填现有 `betogo`（**保留库名，不改名不迁数据**）
- 验收：平台库可查出 tenant #1 及其全部域名
- 交付：`infra/database/platform/001_init.sql`、`scripts/apply-platform-schema.sh`、
  `deploy-fast.sh` 新增 `run_platform_migrations()` 与只跑迁移的 `db` 目标
- 已在阿里云测试环境验证：3 张表建成、tenant #1 + 11 条域名映射入库、应用账号授权通过

### P0-2 租户上下文（AsyncLocalStorage）· 1d ✅ 已完成 2026-09-02
- 新建 `apps/bff-node/src/lib/tenant-context.ts`：`TenantContext { id, code, database, market, status }`
- 提供 `runWithTenant()` / `currentTenant()`；无上下文时明确抛错（禁止静默回落到自营站）
- 验收：单元测试覆盖嵌套调用与异步透传
- 交付：`apps/bff-node/src/lib/tenant-context.ts` + 7 个用例（异步透传、嵌套、并发不串号、
  抛错后释放、欠费降级各档位的充提开关），typecheck 通过
- core-node 侧同一份逻辑在 P0-5 落地（约 40 行，不提前抽公共包）

### P0-3 租户解析中间件（BFF）· 2d ✅ 已完成 2026-09-02
- `Host` → 平台库 `pf_tenant_domain` → 租户；Redis 缓存 300s，降级缓存 30s
  （直接复用 `site-domain.service.ts` 已验证的降级策略）
- 未匹配域名的兜底策略需明确（建议 404 + 告警，不默认落到自营站）
- 挂载位置：`requestId` 之后、鉴权之前
- 验收：不同 Host 解析到不同租户；平台库抖动时走缓存不影响线上
- 交付：`clients/platform-mysql.client.ts`（独立小池，默认 4 连接）、`services/tenant.service.ts`、
  `middleware/tenant.ts`，9 个用例 + 线上验证（Redis 缓存中可见 `188facai.com → tenant#1`）
- **兜底策略最终定为两段式**：`TENANT_RESOLVE_STRICT=false`（默认，观察期）未登记域名回落自营站
  并每域名告警一次；`=true` 直接 404。**第一个包网客户上线前必须切 true**
- 未命中也写缓存（哨兵值 30s），否则乱填 Host 的扫描器能把平台库打满；
  平台库报错时不写任何缓存，避免把故障态钉进缓存 5 分钟
- 线上观察发现两件事，均已修：
  1. 容器启动瞬间 podman DNS 未就绪导致平台库首查失败 → 补 `warmupPlatformMysql()` 六次重试
     （与既有 `warmupMysql` 同一问题，仓库里早有先例）
  2. `/health` 探针以 `Host: 127.0.0.1:3000` 直连，永远匹配不到域名 → 中间件放行无租户语义的路径，
     否则 strict 模式会把健康检查打成 404，容器被判不健康反复重启

### P0-4 连接池按租户路由（BFF）· 2d ✅ 已完成 2026-09-02
- 改造 `apps/bff-node/src/clients/mysql.client.ts:20`：`Map<database, Pool>` + 闲置回收
- **重算连接数上限**：50 租户 × 现有 `MYSQL_POOL_SIZE=10` = 500 连接，超过 MySQL 默认 `max_connections`，
  需改为按租户小池（2-4）+ 总量封顶
- 验收：业务层 SQL 零改动，全量回归通过
- 交付：`mysql.client.ts` 改为 `Map<database, pool>`，6 个用例（不同租户不同库、同租户复用池、
  自营站大池其他小池、无上下文回落、严格模式抛错、并发不串库），全量 154 测试通过
- **池大小分档**：自营站沿用压测验证过的 10；其他租户默认 2（`MYSQL_TENANT_POOL_SIZE`），
  靠 30 分钟空闲回收控总量（自营站池常驻不回收）
- 🔴 **线上实测服务器 `max_connections` 只有 50**（历史峰值 17，当前 11），
  不是 compose 里写的 200。50 租户 × 2 连接 = 100 就已经打爆，
  **接入第一个包网客户前必须先调大 max_connections 并相应调 MySQL 内存**。
  代码里加了 `MYSQL_TOTAL_CONN_BUDGET`（默认 30）超预算即 error 日志告警

### P0-5 连接池按租户路由（core-node）+ 回调归属 · 3d ✅ 已完成 2026-09-02
- `apps/core-node/src/plugins/mysql.ts:12` 改为按请求装饰
- 回调入口无 Host 可依赖 → 回调 URL 加租户段 `/callback/:tenantCode/...`，
  **必须兼容自营站现有回调地址**（三方那边改地址要时间，不能断）
- 兜底：聚合商子代理号 / 商户号 → 租户 反查表
- 验收：win568、unispay、yfpay、matrix 四条回调链路都能落到正确租户库
- 交付：`lib/tenant-context.ts`（端口自 BFF）、`clients/platform-mysql.ts`、
  `plugins/tenant.ts`（onRequest 钩子内 `runWithTenant(…, done)`）、
  `plugins/mysql.ts` 改为 **getter 装饰器** —— 现有 33 处 `app.mysql` 调用一行不用改
- 路由双注册：原路径（自营站现有回调地址继续可用）+ `/t/:tenantCode/…`（新租户开站直接下发）
- 线上验证四种情况：原路径 401 / 租户段 401 / **错误租户段 503（拒绝，不回落）** / win568 200
- 归属优先级：URL 租户段 → Host → 自营站兜底。**带了租户段却查不到时直接拒绝**，
  绝不能悄悄回落自营站去收别家的钱

> **本步踩坑记录（都改了代码，不只是记笔记）**
> 1. **平台库预热不能阻塞启动**。第一版把预热 `await` 在启动路径上，DNS 未就绪时重试 6×3=18 秒，
>    期间服务器不监听 = nginx 502。改为 `void` 后台预热，租户中间件自带重试与兜底。
> 2. 🔴 **mysql2 并发预建满池会把启动卡死**。为盖住 DNS 抖动，第二版用
>    `Promise.all(4 × getConnection())` 预建满池；一旦其中一条失败，其余 getConnection
>    仍占着池槽，重试时 `waitForConnections` 永久等待 —— **测试站因此 502 约 6 分钟**。
>    预热只建一条连接即可。
> 3. 平台库查询加一次重连重试（300ms），盖住容器重启后 aardvark-dns 的短暂抖动。
> 4. 新增「平台库彻底不可用」的启动兜底租户（指向本服务今天就在用的库），
>    仅在非严格模式生效 —— 否则多租户改造等于给资金链路新增一个单点故障。

### P0-6 Redis 全量租户前缀 · 5d 🔴 全项目最高风险 → ✅ 已完成 2026-09-02（实际 <1d）
- 现状：无 `keyPrefix`，35 个文件、约 65 种键模式
- 统一 `tkey()` 构造函数，禁止裸字符串拼键（加 lint 规则拦截）
- 覆盖范围：钱包余额（**含 Lua 脚本里的 KEYS**）、会话、回调幂等键、分布式锁、
  限流计数、games/汇率等缓存、SSE badge、社区/群发的槽位去重键
- 存量键迁移方案：双读过渡（先读新键、回落旧键）→ 后台迁移 → 去掉回落
- 验收：两租户存在相同 userId 时，余额/会话/幂等键完全互不影响（自动化用例）

> **实际做法与原计划不同，风险大幅低于预期。**
>
> 原计划：统一 `tkey()` 构造函数改写 217 处调用 + 双读过渡 + 存量键迁移。
> 实际：**用 ioredis 的 `keyPrefix` 按租户建客户端**，业务侧 217 处调用一行不改
> （BFF 走 `getRedis()`/`ctx.state.redis`，core-node 走 `app.redis` getter 装饰器）。
>
> **关键决策：自营站前缀固定为空串。** 它的键名与今天完全一致，新租户从空 keyspace
> 起步用 `t{id}:`，两边永不冲突 —— 于是**双读过渡与存量迁移这两步高风险操作直接取消**。
>
> **实证（在真实环境跑的，不是查文档）**：
> | 用法 | keyPrefix 是否生效 |
> |---|---|
> | 普通 `set/get` | ✅ 自动前缀 |
> | `eval` 的 KEYS 参数 | ✅ 自动前缀（**钱包余额 Lua 因此安全**） |
> | `keys(pattern)` 模式参数 | ❌ 不前缀，且返回值含前缀，喂回 `get()` 会二次前缀 |
>
> 第三条是真 bug 面：已封装 `scanKeys()` 统一补前缀 / 剥前缀，修掉 3 处调用点。
>
> **端到端验证**：临时把 tenant#1 标记为非自营 → 请求后出现
> `t1:rl:api:*`、`t1:admin:setting:*`、`t1:config:*` → 恢复标记后键回到无前缀，残留已清理。
> 自营站全程 `t*:` 键数量为 0，键名零变化。
>
> 原计划的「lint 规则拦截裸字符串拼键」不再需要：前缀在客户端层面生效，不在键构造处。
> 唯一要守的规矩是**不要绕过 `getRedis()` / `app.redis` 自建客户端**（已确认全仓无此用法）。

### P0-7 定时任务租户化 · 4d ✅ 已完成 2026-09-02
> **待包裹调用点清单已由 P0-4 的观察模式自动采集**（启动 20 秒内即抓到 13 处）：
> `feature-bonus-lock.service` / `sg-game.service`(loadGamesCache、loadSectionOverrides、
> loadFrozenBoards、loadHiddenSections) / `betting-activity.service`(refreshLatestPool、refreshRankTops) /
> `community.service`(listRules→runCommunityTick) / `broadcast.service`(runBroadcastTick)。
> 日频任务（洗码结算、VIP、负盈利、BI 日报）要等触发后才会入列，
> 实施时以「日志清单 + app.ts 任务表逐条比对」双向确认，不能只靠日志。
- BFF `apps/bff-node/src/app.ts:68-250` 共 11 组任务 → 遍历启用租户执行
- core-node 7 个 cron（结算、BI 聚合、风控刷新、分层刷新、win568 三个同步）同理
- 逐租户 `try/catch` + 失败告警，单租户失败不阻断其他
- 分布式锁 key 带租户；业务日切按 **租户 × 市场** 时区（沿用 `207_team_market_timezone`）
- 50 租户以内用简单遍历即可；超出后改队列分发（已记入升级路径）
- 验收：结算类任务金额只影响本租户，跨租户零变动
- 交付：`services/tenant-jobs.ts`（BFF）与 `lib/tenant-jobs.ts`（core-node）统一封装
  `forEachTenant()`：逐租户 `runWithTenant` + 单租户失败只记日志不中断其他租户 +
  同名任务上一轮未结束则跳过本轮（几十个租户串行会超过 30s tick 间隔，不挡会雪崩）
- 覆盖：BFF 13 组任务 + 1 个启动种子任务；core-node 4 个 cron 按租户
- **win568 的 3 个 cron 保持平台级**（`runAsSelfOperated`）：CompanyKey 全平台共用一把，
  按租户跑会把同一把密钥轮换 N 次、同一份报表拉 N 遍。
  等 P1 的 `pf_tenant_provider` 给每租户建独立子代理后再改按租户
- **NATS 消费者补齐租户**：回调/账变消息体加 `tenantCode`，消费者在租户上下文内处理；
  `db`/`redis` 必须在上下文内取，不能在消费者启动时提前捕获（那时没有租户上下文）。
  老消息无 `tenantCode` 时按自营站处理，兼容部署切换瞬间的在途消息
- 线上验证：重启后观察 100 秒，「无租户上下文」告警 **0 条**，任务正常执行

> **本步踩坑：包裹 forEachTenant 会静默废掉外层重试。**
> `forEachTenant` 为隔离故障会吞掉单租户异常，于是 `seedDefaultAdmin`、
> 游戏缓存加载、彩金闸播种这三处「失败后重试」的逻辑第一次失败就被当成成功，
> 重试永远不触发。已把重试全部移进租户回调内 —— 这样每个租户各自重试，
> 反而比原来更好（一个租户失败不再阻塞其他租户）。

> **环境观察**：容器内对 `tma-mysql` 的 DNS 解析并非只在启动瞬间抖动，
> 运行中（如连接池 idle 回收后重连）也会偶发 `ENOTFOUND`。
> 这是既有现象（仓库里多处 retry 注释已提到），P0-7 的逐租户日志让它更显眼。
> 建议 X-4 监控项把它纳入告警基线。

### P0-8 迁移执行器多库化 · 2d ✅ 已完成 2026-09-02
- `deploy/single-node/deploy-fast.sh:53-92` 与完整部署脚本：读平台库租户列表 → 逐库执行
- 注意现有"已有库则标记全部迁移为已执行"的分支（`deploy-fast.sh:60-70`）
  **新建的空库绝不能走这条路径**，否则新站表结构直接是空的
- 失败中止部署并明确指出是哪个租户库
- ✅ **性能问题已提前修掉**（随 P0-1 交付）：改为一次取回该库全部已执行版本再本地比对，
  单库耗时从 >180s 降到 18s；剩余工作是把单库循环扩成遍历租户列表
- 验收：新建空库能建出与自营库结构完全一致的表

> 🔴 **验收时发现的重大问题：历史迁移链无法从 001 重放。**
> 空库跑到 `008_consolidate_order_tables.sql` 就失败（`Unknown column 'credited'`）——
> 历史迁移依赖了后续才补上的列。**这意味着 P1「一键开站」原设计的建库方式根本走不通**，
> 如果等到开第一个客户站时才发现，就是当场卡死。
>
> **解决方案：结构基线（Rails schema.rb / Django squash 同思路），不改 224 个历史迁移。**
> - `scripts/dump-schema-baseline.sh` 从自营库导出 `infra/database/betogo/schema_baseline.sql`：
>   全部表结构 + `schema_migrations` 数据（基线自带「截止到哪个版本」信息）
> - **基线不含 `DROP TABLE`**（`--skip-add-drop-table`）：即使被误对已有库执行也不会清空数据
> - 迁移执行器：目标库表数为 0 → 先应用基线 → 之后的新迁移照常增量执行
> - 新增迁移后需重新生成基线；即使基线滞后也仍然正确（基线之后的迁移会被增量补上）
>
> **验收结果**：空库建出 122 张表、1172 列，与自营库**表清单与列数完全一致**；
> 两个库全量迁移检查耗时 13 秒。

- 交付：`deploy-fast.sh` 的 `run_db_migrations` 改为从平台库读租户清单后逐库执行；
  读不到清单时退回只打 `betogo`（宁可少打新租户库，也不能因平台库抖动跳过自营站）；
  任一库失败立即中止部署并指明是哪个库
- **Codex 提交的 218（支付渠道展示开关）已验证兼容**：新租户库里
  `payment_channels.client_visible` 正常建出，该功能代码走 `getMysqlPool(env)`，天然按租户路由

### P0-9 日志 / trace / NATS / 对象存储加租户维度 · 2d ✅ 已完成 2026-09-02
- 日志与 trace 全链路带 `tenantCode`
  → 用 pino 的 `mixin`（BFF `lib/logger.ts`、core-node Fastify logger 配置）从
  AsyncLocalStorage 取租户，**零调用点改动**，所有日志自动带 `tenant` 字段。
  线上实测：BFF `http` 日志与 core-node 回调日志都带上了 `tenant=betogo`。
  唯一例外是 Fastify 内置的 `incoming request`，它在路由前触发、早于租户解析，取不到；
  与之配对的响应日志和错误日志都有，排障不受影响。
- 对象存储路径按租户前缀隔离
  → `TenantScopedStorage` 包装层，规则与 Redis 前缀一致：自营站空前缀（存量文件 key
  已写进库，不能变），新租户 `t{id}/`。4 个用例覆盖。
  **`put()` 必须返回未加前缀的 key** —— 返回带前缀的会被写进库，
  下次 `get()` 再加一次前缀就成了 `t2/t2/...` 永远读不到（与 Redis `keys()` 同类的双重前缀坑）。
- **NATS subject 按租户拆分**：`betogo.callback.<tenantCode>` / `betogo.ledger.<tenantCode>`，
  消息体同时保留 `tenantCode`（消费者不必解析 subject 就能确定归属）。
  收益：可按租户 purge/replay（单一 subject 做不到）、可按租户独立扩容消费者、
  按租户看吞吐；且**现在只有一个租户、stream 里 0 条消息，迁移成本几乎为零，
  等有 50 个租户跑着真金白银时再改就很贵了**。
  stream 本来就是 `betogo.>`，无需改 stream 配置。

  🔴 **过渡陷阱**：durable consumer 的 `filter_subject` 改不了，而代码只吞
  `consumer name already in use` 错误 —— 直接改过滤器会静默沿用旧配置，
  表现为**回调再也收不到、且没有任何报错**。
  做法：新建 `callback-worker-v2` / `ledger-worker-v2`（过滤 `xxx.>`），
  旧 durable 保留用于排空在途消息，下个发布周期再删。
  Workqueue 保留策略要求消费者过滤不重叠，这两组 subject 不重叠，可以并存。

  线上实测消费者配置：
  ```
  callback-worker      filter=betogo.callback
  callback-worker-v2   filter=betogo.callback.>
  ledger-worker        filter=betogo.ledger
  ledger-worker-v2     filter=betogo.ledger.>
  ```

### P0-10 跨租户越权测试套件 · 3d ✅ 已完成 2026-09-03
- 覆盖方案文档第 9 节 6 条清单，全部自动化
- 交付两层：
  1. `apps/bff-node/src/__tests__/tenant-isolation.test.ts` —— 隔离机制单测 6 例：
     不同租户落不同库、同名键前缀不同且客户端不共用、自营站保持无前缀、
     平台缓存走无前缀客户端、严格模式无上下文即抛错、**并发交错执行不串号**
  2. `scripts/tenant-isolation-e2e.sh` —— 端到端验收：真开一个临时租户
     （独立库 + 基线建表 + 独立域名），驱动流量后断言隔离，`trap EXIT` 保证必清理
- **线上验收结果：11 项全通过**
  ```
  自营站 bg_user=25  钱包(可用/冻结)=1437479/0  账变流水=37
  [OK] 两租户同名配置项互不可见（SELF / TENANT）
  [OK] 租户键带前缀 t6:（t6:config:…、t6:rl:api:…、t6:admin:setting:…）
  [OK] 错误租户段回调必须拒绝(503) / 本租户段可路由(401) / 自营站原路径仍可用(401)
  [OK] 自营站用户数、钱包可用与冻结、账变流水条数验收前后完全未变
  [OK] 租户库用户数与账变流水均为 0
  ```
- ⚠️ **写脚本时踩到的坑**：第一版用了不存在的 `bg_wallet.balance_cents`，
  SQL 查不到列返回空，断言变成「空 == 空」的**假通过**。
  已改为真实字段 `available/frozen` + `bg_wallet_ledger` 条数，
  并在基线查询为空时直接终止验收。**资金类断言尤其不能容忍空值假通过。**
- 清单 5（impersonate 审计）依赖 P1 的平台后台，届时补
- 清单 6（每租户独立 DB 账号）属 P1 开站流水线：每开一站建一个只授权自己库的账号；
  同时发现**关站/删库后授权不会自动回收**（已手工清理 `betogo_t9test`、`betogo_iso_e2e` 的残留授权），
  P1 的关站流程必须包含 `REVOKE`

### P0-11 全站回归 + 测试站验证 · 3d ✅ 已完成 2026-09-03
- 现有单测/集成测试跑通 —— BFF **164 通过**、core-node **70 通过**、两侧 typecheck 通过
- 交付 `scripts/p0-regression.sh`：在服务器上直接探测（不需要浏览器/隧道），
  覆盖服务健康 / 公开接口 / 鉴权链路 / 回调四路径 / 数据完整性 / 日志错误 / 资源占用。
  **线上结果：28 项全通过**
  ```
  服务健康 4/4      公开接口 6/6      鉴权链路 5/5（全部 401，无 500）
  回调链路 5/5      数据完整性 3/3    日志扫描 4/4      资源 1/1
  用户 25 / 钱包(可用/冻结) 1437479/0 / 账变 37 / 注单 10 / 迁移 226
  平台库租户 1 / 域名 11 / 无残留 t*: 键
  MySQL 连接 23 / 上限 50
  ```
- ⚠️ **第一版脚本报了 5 个假失败**（回调用 GET 探 POST-only 路由、路径写错），
  排查后确认全部是探针缺陷、非回归。已修正：`probe` 支持方法参数，
  且 **404 不再算「非 5xx」通过** —— 路径写错会被 404 掩盖成假绿，这类假通过比红更危险。
  日志扫描排除本脚本自己触发的 `/t/nosuch/` 正确拒绝，其余 error 仍会暴露并打印原文。
- **本轮未覆盖、需人工 UAT 的部分**（无凭据与真实资金通道，脚本做不到）：
  注册登录 → 充值到账 → 进游戏 → 投注 → 提现 → 活动领取 → 佣金结算 全链路。
  建议按 `docs/testing/UAT.md` 在测试站人工走一遍后再谈生产。
  浏览器版 `scripts/e2e-smoke.mjs` 需要 Chrome，本机没有，未执行。

---

## P1 开站能力与平台后台

### P1-1 平台库商务表扩展 · 2d
`pf_plan`、`pf_tenant_plan`、`pf_tenant_provider`、`pf_tenant_channel`、`pf_admin`、`pf_admin_role`、`pf_audit_log`

### P1-2 `apps/web-platform` 应用脚手架 · 2d
复用 web-admin 的技术栈与构建配置，独立部署、独立域名、IP 白名单

### P1-3 平台后台：租户列表 / 详情 / 状态管理 · 3d
状态机：试用 → 正常 → 欠费停提现 → 停充值 → 停站 → 关站

### P1-4 域名管理 + 自动证书 · 3d
泛域名解析 + ACME 自动签发；域名用途区分（主站 / App 线路 / 落地页）；证书到期告警

### P1-5 一键开站流水线 · 5d
建库 → 全量迁移 → 种子配置（继承套餐默认值）→ 域名+证书 → win568 `registerAgent`
（`apps/core-node/src/clients/win568.client.ts:65`）→ 支付通道 → **冒烟自检**（注册/充值/进游戏/提现全链路自动跑）
目标：审核通过到可访问 < 30 分钟，全自动无人工 SSH

### P1-6 impersonate（以租户身份登录）· 2d
平台后台签发一次性 token → 跳转租户后台域名 → 全程操作审计留痕

### P1-7 租户后台多租户改造 · 3d
- `admin.<租户域名>` 统一指向同一套 web-admin，按 Host 认租户
- `apps/web-admin/src/App.tsx:81` 的 `RequireRole` 现在只读 localStorage，重做为服务端下发权限
- 后端接口二次校验，前端隐藏菜单不作为安全边界

### P1-8 功能开关矩阵（定制化第一批核心）· 4d
- flag 清单：体育 / 棋牌 / 电子 / 彩票 / 任务 / 签到 / 转盘 / VIP / 洗码返水 / 团队佣金 /
  代理中心 / 社区营销 / TG 群发 / 客服 AI / KYC / TG 登录 / Google 登录 / APP 下载页
- **一个 flag 四处生效**：前台路由、底部导航、后台菜单（`AppLayout.tsx:34` 静态数组改为按 flag 过滤）、BFF 接口
- 验收：关掉某模块后，前台入口消失、后台菜单消失、接口返回 403

### P1-9 `/site/config` 扩展为租户 bootstrap · 2d
一次下发：品牌 + 主题变量 + feature flags + 市场 + 币种 + 语言

### P1-10 品牌包 · 3d
站名、logo（亮/暗）、App 图标、启动图、favicon、主色/强调色/圆角/字体
落地方式：后台上传 → bootstrap 下发 → 运行时注入 `:root`
（`apps/web-tma/src/styles/theme.css` 已是 CSS 变量 + Tailwind v4 `@theme inline`，**零构建成本**）

### P1-11 文案覆盖包 · 3d
租户可覆盖任意 i18n key；服务端下发 patch，客户端 merge 进 i18next
（`apps/web-tma/src/i18n/index.ts` 现为静态 import，需加 override 层）；后台配 key 搜索编辑器

### P1-12 前端去硬编码 · 2d
- `apps/web-tma/src/config/market.ts` 编译期域名表退化为兜底，不再是真相源
- `components/BetogoLogo.tsx` 改为配置驱动
- 全站硬编码站名/品牌文案清理

### P1-13 首页装修扩展 · 4d
在现有 `bg_home_content` / `bg_home_content_image` / `bg_homepage_section_visibility` 基础上
扩为「区块 + 排序 + 每块参数」的配置结构（P3-1 区块化的前置）

### P1-14 套餐可覆盖范围限制 · 2d
业务参数（活动数值、返水费率、VIP 门槛、提现规则、风控阈值）现已是后台配置，
租户化后天然 per-tenant；需增加「套餐允许改动范围」白名单与上下限校验

### P1-15 App 出包参数化 · 4d
包名、图标、启动图、线路组、签名密钥按租户参数化
（复用现有 `app_domain_groups` + `route-health.service.ts` + 路由签名机制）

---

## P2 商务闭环

### P2-1 计费与账户表 · 2d
`pf_billing_plan`、`pf_billing_rule`、`pf_billing_daily`、`pf_invoice`、`pf_invoice_item`、
`pf_tenant_account`、`pf_tenant_ledger`

### P2-2 计费引擎（四种规则可组合）· 5d
`deposit_commission` / `ggr_share` / `turnover_rebate` / `monthly_fee`，支持分档 tier 与组合叠加

### P2-3 GGR 口径实现 · 2d
`deductBonus` / `deductCommission` / `carryOver`（负 GGR 结转）三参数；账单逐项展开可追溯

### P2-4 日切快照任务 · 2d
`pf_billing_daily` **快照后不可变**，规则变更只影响未来周期

### P2-5 账单生成 / 确认 / 核销 · 4d
平台侧生成 → 租户后台确认 → 核销 → 额度账户扣划；争议标记与人工调整（带审计）

### P2-6 租户额度账户 · 3d
押金、授信额度、应收应付、不可变流水；**额度不足 → 转人工队列**（已定：不自动拒绝、不平台垫付）

### P2-7 资金模式 A（平台统一代收代付）· 5d
平台通道池、代付放款链路、`deposit_order` / `withdraw_order` 增加 `settlement_mode` 字段

### P2-8 资金模式 B（租户自带通道）· 3d
租户通道凭据加密存储（后台只显掩码）；**回调必须统一经平台网关落库**，否则分成无凭据

### P2-9 混用模式对账 · 3d
同租户内两种模式并存时，按 `settlement_mode` 拆分对账与账单口径

### P2-10 欠费三级降级 · 2d
停提现 → 停充值 → 停站；每级都要有提前通知与人工介入窗口

### P2-11 平台总览 BI · 4d
各租户库抽数汇总进 `pf_bi_daily`（**不做实时跨库 UNION**）

### P2-12 租户后台账单页 · 3d
对账明细、账单确认、发票下载

---

## P3 定制化深化与生态

### P3-1 首页区块注册表（L2 核心）· 6d
`apps/web-tma/src/views/HomeContent.tsx`（829 行，板块顺序写死在 JSX）拆为约 12 个区块：
近期游戏 / 推荐 / 热门 / Cashback / 高返水 / 高 RTP / 亏损返利 / 电子专区 / 厂商专区 /
排行榜 / 公告 / 横幅；建注册表 + 服务端下发排序数组；后台拖拽排序

### P3-2 底部导航与页面开关可配 · 2d
5 个 tab 的页面、图标、顺序可配

### P3-3 活动模板市场 · 6d
现有活动模板化，租户从模板库挑选并改参数，取代逐家写代码

### P3-4 L3 overlay 构建体系 · 5d
`apps/web-tma/src/tenants/<code>/` + Vite alias 覆盖同名组件；`--tenant=xxx` 出独立产物；
CI 产物隔离与独立 CDN 前缀；overlay 租户的主干发版回归流程

### P3-5 租户自助能力 · 6d
通道自配、活动配置、App 自助出包

### P3-6 跨租户风控联防 · 5d
`pf_risk_blacklist`（设备指纹 / 银行卡 / 手机号 / IP）+ 跨租户撞库识别
—— 包网平台真正的护城河

### P3-7 开放 API · 5d
API key 体系、限流、文档；后台深度定制需求引导到这里，而不是改后台代码

### P3-8 多聚合商接入抽象 · 5d
现为 win568 单一聚合商，抽象出 provider 接口层

---

## X 贯穿项

### X-1 不可定制清单的技术约束 · 2d
钱包账变、注单链路、风控引擎、结算计费四块禁止 overlay 覆盖，
用目录分层 + 构建期校验强制拦截（不能只靠约定）

### X-2 租户数据导出与退出机制 · 2d
按库导出、交付格式、关站后数据保留期

### X-3 备份按库粒度 + 恢复演练 · 2d

### X-4 监控告警按租户维度 · 2d
错误率、回调失败、结算异常、额度告警都要能按租户下钻

### X-5 文档 · 2d
开站 SOP、租户对接手册、销售套餐说明（含**可定制/不可定制清单**）

---

## 关键路径与风险

**关键路径**：P0-1 → P0-2 → P0-3/P0-4 → P0-5 → **P0-6** → P0-7 → P0-8 → P0-11 → P1-5（一键开站）

**风险最高的三项**
1. **P0-6 Redis 前缀** —— 直接动钱包余额键，含 Lua 脚本；漏一个键就是跨租户资金串号
2. **P0-5 回调归属** —— 三方回调地址变更需与聚合商/支付商协调，且不能中断自营站
3. **P0-7 定时结算** —— 结算类任务改错会造成重复入账或漏结

**里程碑**
- ✅ **M1（P0 完成，2026-09-03）：系统具备多租户能力，线上零感知**
- M2（P1 完成）：能对外开出第一个包网客户站
- M3（P2 完成）：商务闭环，能收钱能对账
- M4（P3 完成）：具备规模化交付与差异化定制能力
