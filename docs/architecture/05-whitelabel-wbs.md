# 包网工程 · 完整工作列表（WBS）

> 配套方案：`04-whitelabel-multitenant.md`
> 分支：`feature/whitelabel-multitenant`
> 人天为粗估（单人、含自测，不含需求反复与三方联调波动）

## 总览

| 阶段 | 目标 | 任务数 | 粗估 |
|---|---|---|---|
| P0 租户化地基 ✅ **已完成** | 对外零变化，系统具备多租户能力 | 11 | ~29 人天 |
| P1 开站与平台后台 | 能开出第二个站，定制化第一批交付 | 17 | ~46 人天 |
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

### P1-0 租户连接池策略（初始数 / 最大数）· 已完成 2026-09-03
> 原 P0-4 用的是「自营站 10、其他租户固定 2」的写死策略。租户体量差异极大，
> 试用站和旗舰客户不该拿同样的资源；而租户少的时候限制连接池毫无意义。
> 改为**每租户可配的「初始数 + 最大数 + 排队上限」，后台可改**。

- 平台库 `002_tenant_pool_config.sql`：`pf_tenant` 增加 `pool_min` / `pool_max` / `queue_limit`
  （默认 2 / 10 / 0 —— 前期给足，扛不住再按租户下调）
- 与 mysql2 的对应：`pool_max → connectionLimit`、`pool_min → maxIdle`（**mysql2 没有原生
  「最小连接数」概念，maxIdle 是最接近的语义：常驻空闲连接不回收到更低**）、
  `queue_limit → queueLimit`
- 池创建后**后台顺序预热**到 `pool_min`，并重试 5 轮 ×3 秒盖住容器启动时的 DNS 抖动。
  🔴 预热必须顺序且后台执行：并发 `Promise.all` 取连接一旦有一条失败，
  其余 pending 的 getConnection 会占死池槽导致永久等待（P0-5 因此造成过测试站 502）
- 后台页面「系统设置 → 租户与连接池」（仅 super_admin），改完**立即丢弃旧池**，
  下一个请求按新配置重建 —— `connectionLimit`/`maxIdle` 在建池时固定，不重建不生效
- `poolMax` 上限拍在 100：单租户占满 max_connections 会把其他租户饿死，分库隔离就白做了
- 线上验证：预热未完成告警 0 次；无真实流量时 betogo 已有常驻连接（证明是预热而非按需）
- ⚠️ 仍需先做的前置：**`max_connections` 从 50 调到 300+**，否则池配得再大也没用

### P1-0b 依赖与基础设施升级 · 1d ✅ 已完成 2026-09-05
- `mysql2` `3.22.3` → `3.24.3`（bff-node 与 core-node 两端），行为无变化
- 顺带清掉 **6 个 high 级传递依赖漏洞**：`form-data` CRLF 注入、
  `ip-address` SSRF 边界绕过（本项目大量外呼，这条最要紧）、`brace-expansion` DoS、`nanoid`
- 剩 4 个 moderate 全在 `uuid`（`gaxios` / `nacos` 的传递依赖）。
  漏洞要求调 v3/v5/v6 并传 `buf`，本项目直接用的是 `node:crypto` 的 `randomUUID`，
  走不到那条路径；修它要 `--force` 破坏性升级 google-auth-library 与 nacos，不划算。**留着并记录**
- `max_connections` 的「必须 300+」已由 P1-0c 降级：按 10-20 租户，生产现状 200 就够
- MySQL 服务端 8.0.46 属 8.0 线最新补丁版；升 8.4 LTS 涉及停机与兼容验证，单独排期，不进 P1

> 🔴 **过程中发现并修掉一个部署脚本 bug（影响面大于本任务本身）**：
> `deploy-fast.sh` 先 rsync `package-lock.json`，再用 dry-run 比对同一个文件来判断
> 依赖有没有变 —— 同步完自然就没差异了。结果是 **npm 依赖升级从来不会触发重建镜像**，
> 容器一直跑旧的 `node_modules`，而服务器上的 lock 文件却显示已升级，对不上还极难发现。
> 本次实测：脚本报「重启容器」，容器里仍是 3.22.3。
> 已把比对挪到同步之前，并给 core-node 补上同样的检测（它原本压根没有这一步）。


### P1-0e 测试环境切 `TENANT_RESOLVE_STRICT=true` · ✅ 已完成 2026-09-04
P0-3 留的两段式兜底，观察期结束。未登记域名现在直接 404，不再回落自营站。

**切之前必须先补登记，否则会打断线上入口。** 实测 nginx 服务的域名比平台库登记的多：
`admin.188facai.com`（业务后台入口，反代 :8085）与 `a001.188facai.com` 都未登记，
且 `normalizeHost()` 只剥 `www.` 前缀，`admin.188facai.com` 不会匹配到 `188facai.com`。
两个域名已补登记（分别为 `admin` / `site` 用途）后再切。

- core-node 不受影响：那边的 `TENANT_RESOLVE_STRICT` 只管「平台库不可用时的启动兜底」，
  **不关闭 win568 老回调路径的自营站回落** —— 回调链路 5 项验证全过
- 验证：`www` / 裸域 / `admin.` / `a001.` / `betogo.games` / `demo1.local` 均 200，
  `nosuch.example.com` → 404，`/health` 200
- ⚠️ **`p0-regression.sh` 因此需要修**：它用 `http://127.0.0.1:3000` 直连探测，
  Host 是 `127.0.0.1`，strict 下属未登记域名，11 项探测全 404。
  这是**探针工件不是回归**（真实流量都经 nginx 带域名进来）。已让 BFF 直连探测带上真实 Host；
  回调链路那两项标 `--no-host` 保留原意 —— 它们要探的正是「无 Host 时如何归属租户」，
  带上 Host 就测不到回落路径了。修后 28 项全过

### P1-1 平台库商务表扩展 · 2d ✅ 已完成 2026-09-03
交付 `infra/database/platform/003_business_tables.sql`，平台库现有 12 张业务表：

| 表 | 用途 |
|---|---|
| `pf_plan` / `pf_plan_feature` | 套餐 + 功能开关矩阵（20 项功能） |
| `pf_plan_override` | 套餐允许租户覆盖的配置范围（P1-14 的数据基础） |
| `pf_tenant_plan` | 租户套餐，带 `ended_at` 保留换套餐历史 |
| `pf_tenant_feature` | **租户级开关覆盖**，优先于套餐默认值 |
| `pf_tenant_provider` | 聚合商子代理账号 + 密钥密文 |
| `pf_tenant_channel` | 支付通道，`owner` 区分双资金模式且可混用 |
| `pf_admin` | 平台管理员，**与租户后台管理员完全分离** |
| `pf_audit_log` | 平台操作审计，只追加，impersonate 全程留痕 |

设计要点：
- **加了 `pf_tenant_feature`（原计划没有）**：真实运营一定会出现「这家先别开提现」这类需求，
  只有套餐粒度不够用。优先级 租户覆盖 > 套餐默认
- 密钥一律 `credential_cipher` + `credential_iv` 存密文，**明文不落库，后台只显掩码**
- `pf_tenant_channel.merchant_no` 建了索引：回调反查租户的兜底依据（P0-5 留的口子）
- 种子：三档套餐对应定制化三批交付；**功能矩阵先全开**（租户少时不该靠套餐限制功能，
  要限制用 `pf_tenant_feature` 对单个租户关）；自营站挂旗舰版
- ⚠️ 踩坑：`INSERT ... SELECT` 里带 `UNION` 时 MySQL 不接受 `ON DUPLICATE KEY UPDATE`，改用 `INSERT IGNORE`

### P1-2 `apps/web-platform` 应用脚手架 · 2d ✅ 已完成 2026-09-03
- 前端：`apps/web-platform`（React 19 + antd 5 + Vite，base `/platform/`），
  登录页 + 租户总览 + 布局；**独立 token key** `platform_token`，
  与租户后台 `admin_token` 隔离，同一浏览器同时开两边不会互相顶掉登录态
- 后端：`services/platform-auth.service.ts` + `middleware/platform-auth.ts` +
  `routes/platform/index.ts`（`/api/v1/platform/*`）
  - 会话键 `platform:sess:`，**走无前缀 Redis 客户端** —— 平台身份跨租户，
    走带 keyPrefix 的客户端会被当前请求所属租户污染，换个域名进来就读不到会话
  - 账号不存在时也走一次密码校验，避免用响应时间差枚举账号
  - 超管密码只从环境变量播种，**不写死默认密码**
- 部署：`deploy-fast.sh` 新增 `web-platform` 目标；`nginx-platform.conf` 提供
  `/platform/` 静态目录 + `noindex` 头 + IP 白名单占位
- 线上验证：页面 200、未登录 401、登录返回 `platform_super`、
  `/auth/me` 与 `/tenants` 正常（返回自营站：旗舰版 / 2 市场 / 11 域名）、错误密码 401

> 🔴 **发现一个影响面更大的问题：容器环境变量是 `recreate-*.sh` 里的显式白名单。**
> 也就是说 P0 加的 `TENANT_RESOLVE_STRICT`、`MYSQL_PLATFORM_DATABASE`、
> 连接池相关变量，**改 `.env` 根本不生效**（`podman restart` 沿用建容器时的环境）。
> 已把这些变量补进 `recreate-bff-node.sh` / `recreate-core-node.sh`。
> **注意：改这类环境变量必须走 `recreate-*.sh` 重建容器，快速部署的 restart 不够。**

> ⚠️ 环境遗留问题（非本次引入，已第三次出现）：容器网络对 `tma-mysql` 的 DNS
> 偶发 `ENOTFOUND`。本次给 `listRunnableTenants` 加了一次重试 ——
> 取不到租户清单会让**整轮定时任务被跳过**，代价太大。
> 根因属基础设施层（podman aardvark-dns），建议作为独立运维任务处理。

### P1-3 平台后台：租户列表 / 详情 / 状态管理 · 3d ✅ 已完成 2026-09-03
- 详情接口一次返回：基本信息 + 套餐 + 连接池 + 市场 + 域名 + 聚合商子代理 + 支付通道
- 状态机（服务端强校验，前端只是少让人点错）：
  ```
  trial              → active / suspended / closed
  active             → trial / withdraw_suspended / deposit_suspended / suspended / closed
  withdraw_suspended → active / deposit_suspended / suspended / closed
  deposit_suspended  → active / withdraw_suspended / suspended / closed
  suspended          → active / closed
  closed             → 终态，不可再变
  ```
- **自营站禁止改状态**：把它停了等于把整个平台自己关了
- 状态变更后**立即清租户解析缓存**，否则最长 5 分钟内旧状态还在放行
- 所有平台侧写操作写 `pf_audit_log`（管理员 / 租户 / 前后状态 / IP），
  包网出纠纷时这是唯一事实依据；审计写失败不阻断业务
- 线上验证：合法降级链全通过、`suspended → withdraw_suspended` 被拒、
  `closed` 终态不可变、自营站被拒、5 条审计留痕齐全，临时租户已清理

### P1-0c 容量测算结论（2026-09-03）
基线连接（与租户数无关）约 31（BFF 自营 10 + 平台 4，core-node 同样，运维 3），
测试环境实测峰值 22-23。每租户最坏 = BFF `pool_max` + core `pool_max`。

| 目标租户数 | 每租户 pool_max | 需要 max_connections | 生产(200) | 测试(50) |
|---|---|---|---|---|
| 10 | 2 | ~71 | ✅ | ❌ 需 80 |
| 10 | 4 | ~111 | ✅ | ❌ 需 120 |
| 20 | 2 | ~111 | ✅ | ❌ |
| 20 | 4 | ~191 | ⚠️ 卡满，建议 300 | ❌ |

- **按 10-20 租户，生产现状（200）就够**，原「必须提到 300+」是按 50 租户算的，可降级
- 测试机 1GB 内存是硬约束：最多 100 连接、5-8 个租户做功能验证，**容量验证做不了**
- 真正的瓶颈是 **4 核 CPU 与慢查询**，不是连接数

### P1-4 域名管理 + 证书巡检 · 3d ✅ 已完成 2026-09-05（核心 `bc7c0947` / `dd48e5ac`，ACME 收尾 2026-09-05）
- 平台库 `004_domain_cert_tracking.sql`：域名表补 `cert_status` / `cert_expires_at` /
  `cert_checked_at` / `cert_detail` / `dns_resolved_ip` / `domain_type`
- `domain-cert.service.ts`：DNS 走公共 resolver，TLS 握手读证书有效期，30 天内标 expiring
- 平台控制台域名 CRUD + 巡检按钮；子域名由平台按租户代号生成，**不接受调用方指定**
  （否则可借此抢注他人子域名，或写出泛解析覆盖不到的地址）
- 护栏：不能删除最后一个 site 域名（删了该租户前台彻底无法访问）
- 线上验证：11 个真实域名巡检准确（188facai.com → issued，到期 2026-11-25，与 openssl 直读一致）

**ACME 自动签发已补齐 2026-09-05**（`009_domain_acme.sql` + `deploy/single-node/issue-tenant-certs.sh`
+ `betogo-cert.timer`）：客户把 A 记录指过来后，最多一小时自动拿到证书并生成 nginx vhost。

- **签发跑在宿主机，不在 bff-node 里**。容器碰不到宿主机的 nginx 与 certbot，
  在平台后台放一个「签发」按钮只会得到一个永远失败的按钮。平台库负责「该签哪些、上次签得怎么样」，
  真正动线上配置的那一步留在宿主机、留在人能看到 journal 的地方
- **DNS 没指过来就不签**。失败的挑战同样计入 Let's Encrypt 的失败限流，
  客户慢慢配 DNS 的这几天足够把额度撞光
- **两段式写 vhost**。模板里的 443 段引用了还不存在的证书文件，整份直接落地会让
  `nginx -t` 失败、连带整台机器都 reload 不了。先只写 80 端口的挑战块，签成了再整份覆盖；
  任一步 `nginx -t` 不通过就回滚并记原因
- `acme_enabled` 开关：证书托管在 Cloudflare 等外部的域名关掉它，平台不去动人家的证书。
  **自营站 11 条历史域名迁移时直接置 0** —— 它们的证书是手工签的、也在别处续期
- 续期交给 certbot 自带的 timer；本脚本只管首签与 vhost 补齐，幂等（证书还够 30 天就跳过）
- 平台控制台「域名」表新增「自动签发」列，鼠标悬停显示上次签发时间或失败原因

### P1-5 一键开站流水线 · 5d ✅ 核心已完成 2026-09-03（建库→基线→种子→登记→自检）
**线上实测：7 秒开出一个可用的新站。**
```
租户 id=9  库=betogo_demo1  表=122
冒烟自检 9/9 全通过：表结构 122 / 全站配置 36 / 活动配置 64 / 游戏库 12274
                    后台管理员 1 / 用户表为空 / 注单表为空 / 域名 2 条 / 种子 21 张表全成功
种子 23793 行
新站验证：域名访问 site/config 200、首页 200、游戏列表 200
         Redis 键带 t9: 前缀、租户后台可用开站创建的超管登录（super_admin）
自营站零影响：25 用户 vs 新站 0 用户
```

**关键设计**
- **种子表白名单**（21 张配置/参考表）而非整库复制。判断标准是「平台预置的默认配置」
  还是「该站运营产生的数据」。另有 `SEED_EXCLUDED_REASON` 记录为什么不复制某些表 ——
  反例 `admin_accounts` 一旦被复制，新租户就拿到了自营站的管理员账号
- 种子用跨库 `INSERT...SELECT`，永远反映当前默认配置，不维护会过期的种子文件
- **开站账号与应用账号分离**：应用账号无全局 CREATE；开站账号有建库权但
  **刻意不给 GRANT OPTION**（那等同 root）。应用账号改用通配授权 `betogo\_%`.*，
  新库自动覆盖，开站流程因此完全不需要动态授权
- 失败即 `DROP DATABASE` 回滚，不留半成品库挡住重试
- 每步带标签，失败信息形如「开站失败于「应用结构基线」：...」

**三个踩坑（都改了代码）**
1. 🔴 **基线里的 `LOCK TABLES` 导致开站失败**，报错是「Access denied to database」——
   完全看不出是缺锁权限。修法不是给开站账号放权，而是 `mysqldump --skip-add-locks`，
   并在 `dump-schema-baseline.sh` 加护栏：基线含 `LOCK TABLES` / `DROP TABLE` /
   `CREATE DATABASE` / `USE` 一律拒绝生成
2. **种子表外键顺序**：`bg_spin_prize` 外键指向 `bg_spin_deposit_rule` 而排在其前，
   复制失败。修法是复制期间关 `FOREIGN_KEY_CHECKS` —— 靠人工维护插入顺序迟早会错
3. 🔴 **冒烟自检报「全部通过」但有种子表失败** —— 又一个假绿。
   已把种子结果计入冒烟结论

**外部对接已补齐 2026-09-05**（域名自动证书见 P1-4）。

> **「自动注册」这件事本身做不到，也不该做。** 在 568win 开一个子代理、在支付商开一个商户号，
> 都是线下签约动作，没有对外的开户 API。能自动化的是**登记之后的一切**：
> 平台后台录一次 → 一键下发到租户库 → 该租户的调用自动用自己的凭据，人肉改配置那一步没有了。

- **凭据加密**（`platform-credential.service.ts`，AES-256-GCM）：`pf_tenant_provider` /
  `pf_tenant_channel` 的 `credential_cipher` 至今没人写过，这次真正用上了。
  **没配 `PLATFORM_CREDENTIAL_KEY` 时加密直接抛错，不退化成明文存** —— 在密钥这件事上
  "配置缺失就静默降级"是最糟的选择：库里躺着明文，后台看起来一切正常
- **win568 子代理**：平台后台录账号/CompanyKey/ServerId → 下发写进租户库的
  `win568_operation_company_key` / `win568_server_id`（就是 core-node 今天读的那两个键，
  不需要新增任何代码分支）。`Win568Client` 的 `serverId` 从写死 env 改为构造参数
- **P0-7 留的尾巴一并了结**：`runAsSelfOperated` 换成 `runForProviderTenants` ——
  自营站 + 每个有 active 独立子代理的租户各跑一次；共用平台子代理的租户**不单独跑**
  （同一把 key、同一个 ServerId，再跑一遍就是重复拉同一份报表、重复轮换同一把密钥）。
  旧函数已无调用点，删掉
- **支付通道**：平台后台分配通道（归属/商户号/密钥/排序）→ 下发时从自营库复制该 provider 的
  整行到租户库 `payment_channels`（费率等默认值有据可依），**未分配的一律关闭并对客户端隐藏**

> 🔴 **开站时发现的真问题：`bg_admin_settings` 是整表种子复制的，里面混着自营站的机密。**
> 这不是洁癖问题，是三个实打实的故障：
> 1. `site_domain_mappings` —— 新租户的 App 线路表下发的会是**自营站的域名**，
>    等于把客户的用户送去别家站点（P1-15 给 `/app/bootstrap` 加的兜底防线，
>    正是被这条种子绕过的）
> 2. `op_password` —— 两家的余额调整用同一个操作密码
> 3. `win568_operation_company_key` / `win568_sw_company_key` —— 客户后台能看到平台的聚合商密钥
> 4. `win568_report_sync_watermark` 等水位 —— 新站带着自营站的拉单水位，会漏拉水位之前的注单
>
> 已加 `SEED_PURGED_SETTINGS`：种子之后逐条删掉（附每条的理由），让它们回落 env / 平台默认。
> 冒烟自检加了一项「自营站专属配置已清理」—— 漏清不会让开站失败，但客户库里就躺着平台的密钥。

**仍未做（明确留给 P2）**：商户号 → 租户的回调反查。它要在**资金链路**上解析回调 body 才能拿到
商户号，改动的是 core-node 的 onRequest 归属逻辑；而新租户的回调地址本来就带租户段
（P0-5 已支持），现在没有非做不可的理由。等 P2-8 双资金模式一起做，届时平台统一代收会出现
"同一个商户号收多家的钱"，那时才真正需要它。

凭据加解密单测 6 项（往返、iv 不重复、GCM 篡改检测、掩码、缺 key 抛错、key 长度不对当没配）。

> ⚠️ **关站流程必须包含的清理项**（本次实测发现残留）：
> 删租户时除了删库与平台库记录，还要清 **该租户的 Redis 键 `t<id>:*`** 和
> **MySQL 授权**。第一次开站尝试留下的 `t8:*` 键被回归脚本抓到了。

### P1-0d 容器网络 DNS 抖动 · ✅ 已完成 2026-09-04
根因与原先记录的假设**不同**，实测定位后已修复。

**真实根因：Alpine（musl）并行 DNS 查询 + 上游 DNS 抢答 NXDOMAIN**
- 应用镜像是 Alpine，musl 的 resolver 把查询**并行**发给 `resolv.conf` 里的全部
  nameserver，**谁先回就用谁的应答**（glibc 是顺序 failover，不会这样）
- 容器内 `resolv.conf` = `[10.89.0.1 podman dnsmasq, 100.100.2.136, 100.100.2.138]`，
  后两个是阿里云 VPC DNS，对 `tma-mysql` 这种容器名返回 **NXDOMAIN**，
  且经常比 dnsmasq 先到 → `getaddrinfo ENOTFOUND`
- **与 aardvark-dns 无关**：这台机器用的是 CNI `dnsname` 插件 + dnsmasq，
  podman 4.9.4，压根没装 aardvark。原先的「重建 MySQL 容器分配静态 IP + 安排维护窗口」
  是照着错误根因开的药方
- 为什么「租户数增加后更频繁」：这是**竞态**，不是抖动。租户多 → 冷池新建连接多 →
  `getaddrinfo` 调用多 → 撞上抢答的绝对次数线性上升。日志里 147 次 ENOTFOUND
  **全部属于 `demo1`**（新开的站，池是冷的），自营站因 P1-0 预热有常驻连接几乎不触发

**实测数据（同一容器，300 次并发解析 `tma-mysql`）**

| 条件 | 成功 | 失败 |
|---|---|---|
| 现状 | 289 | 11（ENOTFOUND，约 3.7%） |
| 加 `--add-host` | 300 | **0** |

**修法：把容器间的名字写进 `/etc/hosts`，这条链路彻底不走 DNS**（musl 查 files 先于 dns）
- 新增 `deploy/single-node/peer-hosts.sh`：集中定义 5 个容器的固定 IP，
  并生成 `--add-host` 参数。**固定 IP 取的就是各容器当前已持有的地址**，
  所以不需要停机重建 MySQL —— 原计划的维护窗口直接省掉了
- `recreate-bff-node.sh` / `recreate-core-node.sh` / `podman-prod-minimal.sh` /
  `podman-prod-full.sh`：容器启动加 `--ip`（把地址钉住，hosts 条目才不会失效）
  + `--add-host`（tma-mysql/mysql、tma-redis/redis、tma-nats/nats、tma-core-node、tma-bff-node）
- 🔴 **IP 与 hosts 必须一起维护**：把错误 IP 钉进 hosts 比 DNS 抖动更糟（100% 失败而非 4%）。
  因此 `peer_host_args()` **以运行中容器的真实 IP 为准**，只在取不到时才用固定值，
  发现漂移会打警告 —— 宁可跟着漂，也不钉死一个错的
- bff 多实例时只有主实例占固定 IP，副实例仍走动态分配（hosts 照常注入）
- 外网解析不受影响：容器内 `api.telegram.org` 正常解析
  （`test-api.568win.com` 解析失败是既有问题，宿主机同样解析不了，与本次无关）

**线上验证（阿里云测试环境）**
- bff-node 并发 2000 次解析（tma-mysql / redis / tma-core-node / nats）：**失败 0**
- core-node 并发 1500 次：**失败 0**
- `p0-regression.sh`：**28 项全过、0 失败**（此前因本问题长期报红）
- 业务链路：`/health`、`site/config` 均 200

### P1-6 impersonate（以租户身份登录）· 2d ✅ 已完成 2026-09-05
平台后台签发一次性票据 → 跳转租户后台域名 → 那边兑换成租户会话，全程留痕。

- **不直接下发租户 token**：平台域名与租户域名不同源，token 传不过去；
  且票据 60 秒即焚，比把一个 8 小时的后台 token 塞进 URL 安全得多
- 🔴 **票据必须绑定租户，兑换时校验与当前域名所属租户一致**。
  不校验的话，拿到 A 租户的票就能在 B 租户的后台域名兑换出 B 的超管会话
- 票据放**无前缀 Redis**：签发在平台控制台（无租户上下文），兑换在租户域名
  （前缀 `t{id}:`）。走带前缀的客户端会导致两端读写不同的键，永远兑不出来
- 用 **GETDEL** 而不是 GET + DEL：两条命令之间的窗口足够让同一张票被用两次，
  那等于签发了一个可复用的后台登录凭据
- 会话绑到租户**真实的** super_admin 账号 id（审计表 admin_id 无外键，
  但填不存在的 id 会让「按管理员查审计」永远查不到这些记录），
  username 改写成 `<平台管理员>@impersonate` —— 每条审计行自带来源
- **不刷新 last_login**：那是账号主人自己登录的口径，被代登录一次就改掉会让
  「这个账号多久没人用了」失真
- impersonate 会话 TTL 1 小时（正常登录是 8 小时）：它是平台方临时代客户操作的通道
- 落地页只兑换一次：React 18 StrictMode 会把 effect 跑两遍，
  第二遍拿已销毁的票据会把成功的登录显示成失败

**线上验证**
```
签发      → https://admin.demo1.local/admin-panel/impersonate?ticket=…
跨租户    在自营站域名兑换 demo1 的票 → 401 ✅
正确域名  兑换成功，username=admin@impersonate role=super_admin
重放      同一张票第二次 → 401 ✅
会话隔离  该会话访问 demo1 后台 200，访问自营站后台 401 ✅
审计      租户自己的库里可见 admin_impersonate_login + 平台管理员身份
```


### P1-7 租户后台多租户改造 · 3d ✅ 核心已完成 2026-09-03（`5da3b559` / `576a38a3`）
- `admin.<租户域名>` 按 Host 认租户：无需专门改造，P0-3 的租户中间件全局挂载即已覆盖
- 🔴 **关掉了一个真实越权面**：业务后台原有「租户与连接池」页（`/admin/tenants`），
  任何租户的 super_admin 都能看到**全部租户**的库名、连接池配置、域名数量。已删除该页与路由，
  改连接池的能力迁至平台控制台 `PUT /platform/tenants/:id/pool`（限 platform_super）并补审计
- `db-backup` 越权修复：备份操作原会碰到非本租户的库
- 开站自动分配业务后台域名 `admin.<主域名>`（purpose='admin'）——
  此前所有域名都写成 `site`，租户拿不到后台入口
- 系统排查了跨租户能力面：平台库直连、硬编码库名、文件系统访问、外部命令、
  无前缀 Redis 客户端、硬编码租户 id —— 除 db-backup 外均无问题

**加固已补齐 2026-09-05**：新增 `GET /admin/auth/me`，角色与功能开关一次下发。
`RequireRole` 改用服务端会话下发的 `verifiedRole`，另有 3 个视图
（BiDashboard / BiAdSources / BiChannels）里直接读 `localStorage.admin_role` 判权限的地方一并改掉。
- 还没拉到角色时**不放行**：默认放行会在页面加载那一小段窗口里露出内容
- `localStorage.admin_role` 保留但降级为「首屏渲染用的缓存」，注释写明不得用于权限判断
- 合并掉了 P1-8 加的 `/admin/features` —— 两个端点做重叠的事没必要

### P1-8 功能开关矩阵（定制化第一批核心）· 4d ✅ 已完成 2026-09-04
20 个 flag（P1-1 已建表，此前无人消费）现已四处生效。

**优先级：租户覆盖 > 套餐默认 > 全开**
- `tenant-feature.service.ts`：`pf_plan_feature` 叠加 `pf_tenant_feature`
- `enabled=null` 语义 = **删除覆盖、回落套餐默认值**。没有这个语义就只能靠
  「写一个和套餐相同的值」假装恢复，换套餐后会留下钉死的错值
- 🔴 **平台库故障时兜底为全开**。反过来（全关）会把一次抖动放大成全站功能消失，
  比「该关的模块多开了几分钟」严重得多。真要硬关（如禁提现）靠租户状态机，不靠这里
- 🔴 **缓存必须走无前缀 Redis 客户端**。开关是平台级数据、由平台控制台失效；
  走 `ctx.state.redis`（带租户前缀）会写成 `t9:platform:tenant-features:9`，
  而控制台删的是 `platform:tenant-features:9` —— 失效静默失败，改了开关前台不生效。
  已把 Redis 客户端收进 service 内部，只收 `env`，让调用方**不可能**传错

**一个 flag 四处生效**
| 生效点 | 实现 |
|---|---|
| BFF 接口 | `requireFeature()` 挂路由前缀：kyc / checkin / task / team / agent / vip / cs_ai / rebate / spin |
| 游戏品类 | `listGames` 加 `blockedSortCategories`，**在分页前剔除**，total/pages 与实际可见数一致；点名已关品类返回 403 而非空列表（空列表看着像「暂无游戏」，会被误判成数据问题）|
| 前台路由 | `parseAppRoute` 对已关模块返回 null → 调用方跳回首页。直链/历史/分享都走这里，光隐藏入口挡不住 |
| 底部导航 | `NAV_ITEMS` 过滤 team；其余四项是所有租户共有的骨架 |
| 后台菜单 | `AppLayout` 静态数组加 `feature` 声明，沿用既有 `roles` 的过滤管道；`GET /admin/features` 下发 |
| 平台控制台 | 租户详情页三态矩阵（跟随套餐 / 单独开 / 单独关），同时显示套餐默认值与生效值 |

- 钱包 / 账变 / 存提 / 注单**刻意不挂开关**：所有租户共有的资金链路，不属可关闭的定制化模块
- 前端过滤只是体验层，`isFeatureEnabled` 拉不到时按全开 —— 与后端兜底方向一致，
  且点进去后端照样 403

**线上验证（关掉 demo1 的转盘与体育）**
```
接口层    demo1 /spin/status 403   自营站 200        （无跨租户串号）
品类屏蔽  demo1 点名 sports 403    自营站 200
         不点名时 demo1 total 5017 vs 自营站 5052（少 35 款体育游戏）
缓存      改完 bootstrap 立即反映，不用等 300s
恢复      改回「跟随套餐」后 spin/status 回到 200，总数回到 5052
鉴权      未知 key 400、未登录 401
审计      4 条 tenant.feature 留痕，from/to 齐全
```
单测 9 例（覆盖两个方向的覆盖优先级、脏 key 不入结果、缓存命中不查库、
缓存键不带租户前缀、平台库故障不写缓存）。全量 175 测试通过，回归 28/28。

**未完成**：`lottery` 与棋牌（`table`）两个 flag 只在前端导航生效，游戏库里没有对应的
`sortCategory` 取值，接口层无从过滤。宁可少管一个品类，也不凭空造一个匹配不到
任何游戏的映射假装管住了。

### P1-9 `/site/config` 扩展为租户 bootstrap · 2d ✅ 已完成 2026-09-04
一次下发：品牌 + 主题变量 + feature flags + 市场 + 币种 + 时区。
`domain` / `market` 是既有字段，**只增不改** —— 老版前端拿到多余字段会忽略，可灰度。

```
{ domain, market, tenant:{code,status},
  brand:{siteName,shortName,logoTextPrimary,logoTextAccent,tagline,
         logoLightUrl,logoDarkUrl,faviconUrl,appIconUrl},
  theme:{...}, features:{...}, currency, timezone, markets:[] }
```
- 币种取自 `pf_tenant_market`。域名没配市场映射时（租户库 `site_domain` 里没这条），
  **单市场租户可无歧义推定，多市场租户不猜** —— 下发一个错币种比不下发严重得多，
  客户端还有自己的兜底逻辑。自营站是双市场，`188facai.com` 仍返回 null，与改动前一致
- 无租户上下文（strict=false 且平台库同时挂了）时仍下发默认品牌，否则前台会变成空白站
- **语言未下发**：locale 目前由客户端按市场推导，库里没有对应数据源，
  服务端下发等于把客户端逻辑复制一遍而没有新的真相源。留到 P1-11 文案包一起做

### P1-10 品牌包 · 3d ✅ 已完成 2026-09-04
平台库 `005_tenant_brand.sql` + 平台控制台品牌配置卡片 + 前台运行时注入。

- **放平台库不放租户库**：品牌是平台交付给客户的东西，开站时就要能配好；
  放租户库的话开站流程得先建库再回头写品牌，且租户后台能改自己的品牌名不合适
- **文字 logo 与图片 logo 并存**，配了图用图、没配用文字。包网客户开站当天
  往往还没有 logo 图，填个站名和文字 logo 就能先把站挂上自己的名字
- 🔴 **主题变量是白名单不是任意 CSS**：`primary` / `primaryForeground` / `accent` /
  `accentForeground` / `radius` / `fontSans` / `fontDisplay`，且按类型校验
  （颜色须 `#RRGGBB`、长度须 rem/px、字体名挡掉引号分号）。
  开放任意 CSS 变量等于把后台配置变成注入面，且租户改坏布局后分不清是谁的锅
- 前台注入：`theme.css` 本就是 CSS 变量 + Tailwind v4 `@theme inline`，
  覆盖 `:root` 变量即全站换色，**零构建成本**（与 P1 规划时的判断一致）
- 资产上传走**租户上下文**：存储层按 `currentTenant()` 加 `t{id}/` 前缀，
  平台控制台没有租户上下文，不用 `runWithTenant` 包住会把客户的 logo 存进自营站目录
- 资产读取复用 `/api/v1/home/images/*`（白名单加 `brand/`）：那条路由按 Host 认租户、
  再按租户前缀读文件，各租户资产天然隔离，不需要另起一套服务路径。
  平台控制台不在租户域名下，另给了一个代读端点做预览
- 上传与落库分两步：上传只产出 key，写进哪个位置由保存决定，传错了不改配置就不影响线上
- 自营站在迁移里登记了现有品牌（BETOGO/B/BETO/GO/Bet. Go. Win）。
  值和代码默认值一样，但「配置为空」与「配置成当前值」在后台看起来完全不同，
  不登记运营会以为品牌没配

**线上实测（给 demo1 配 LuckyOne 品牌）**
```
demo1   siteName=LuckyOne  logo=LUCKY/ONE  theme={primary:#00c853, radius:1.25rem, ...}
自营站  siteName=BETOGO    logo=BETO/GO    theme={}          ← 零影响
资产    上传→落 t9/brand/… ；demo1 读自己 200，自营站读 demo1 的 404（隔离成立）
校验    primary:"red" 400 / CSS 注入 400 / 未知变量 400 / logoKey 路径穿越 400
审计    tenant.brand 与 tenant.brand.asset 均留痕
```

### P1-11 文案覆盖包 · 3d ✅ 已完成 2026-09-05
平台库 `006_tenant_i18n.sql` + bootstrap 下发 patch + 平台控制台 key 搜索编辑器。

- 存**扁平点号键**（`checkin.title`）而不是嵌套 JSON：编辑器要按 key 搜索、按条增删，
  嵌套结构做不到。客户端用 `i18n.addResource()` 逐条盖上去，
  点号键的嵌套还原交给 i18next，不必自己再写一遍
- 🔴 **key 目录是显式构建产物**：i18n 词条定义在 `apps/web-tma` 里，BFF 与平台控制台
  都读不到它的源码。与其让 BFF 反向依赖前台源码，不如像 `schema_baseline` 那样
  产出 `infra/i18n/keys.en.json`（`scripts/dump-i18n-keys.mjs`，1334 条）。
  词条改动后需重跑，否则编辑器搜不到新 key —— **只影响后台搜索，不影响前台**
- 目录读不到时接口报 **503 而不是返回空目录**：空目录会让人以为「一条 key 都没有」，
  而不是「产物没生成」
- **覆盖条数上限 800**（所有语言合计）。bootstrap 每次页面加载都带上全部覆盖，
  放任增长会拖慢首屏；客户端要能运行时切语言而不重拉 bootstrap，所以必须一起下发
- 覆盖不存在的 key 不报错：后台加了新 key、前端还没发版的过渡期不该炸
- 编辑器不提供「浏览全部 key」入口 —— 1334 条翻不动，搜索才是实际用法
- 容器挂载从 `infra/database` 放宽到整个 `infra`（只读），**改挂载必须重建容器**

**线上验证**
```
key 目录     total=1334，搜 checkin.title 命中并带出平台默认文案
覆盖         demo1 配 en/id 两条 → bootstrap 下发，自营站 i18nOverrides={} 零影响
校验         locale=fr 400 / keyPath="a b;drop" 400 / value=123 400
删除         删掉 id 那条后只剩 en，该条回落平台默认文案
审计         add/add/delete 三条留痕
```


### P1-12 前端去硬编码 · 2d ✅ 已完成 2026-09-04
- `BetogoLogo.tsx` → **`SiteLogo.tsx`**，配置驱动。组件名里带自家品牌，本身就是要清的硬编码
- `market.ts` 的 `DEFAULT_DOMAIN_MARKETS` 明确降级为兜底并注释说明：
  真相是服务端 bootstrap，其次是它上次对该域名的判定，编译期快照只在两者都拿不到时才用。
  **包网客户的域名永远不会出现在这张表里**，他们必须靠服务端下发
- 文案里的品牌名改为 i18next 全局插值 `{{brandName}}`（`interpolation.defaultVariables`）：
  品牌名散落在四个语言包十几条文案里，逐条传参一定会漏
- ⚠️ **顺序依赖**：`main.tsx` 里 `await initSiteMarketConfig()` 必须在 `import('@/i18n')` 之前，
  i18n 初始化时品牌才已就位。调换顺序不报错、只是所有文案回落成 BETOGO —— 客户站上就是事故。
  已在 `i18n/index.ts` 注释里写明
- 视图层剩余硬编码（安装引导、下载页、版权行）改为 `getSiteName()` / `getBrand()`
- `betogo_token` 这类 **localStorage 键名刻意不改**：它们是内部标识不是品牌文案，
  改了会让所有存量用户掉登录态，收益为零


### P1-13 首页装修扩展 · 4d ✅ 已完成 2026-09-05
「区块 + 排序 + 每块参数」落地。迁移 `219_home_section_layout.sql` 在原
`bg_homepage_section_visibility` 上加 `sort_order` + `params`，**不改表名**：
改名要同步基线与 3 处调用点，且代码先于迁移上线就整块报错，收益只是名字更贴切。

- **区块从 12 个游戏板块扩到 19 个**：新纳管 banner / 顶部公告 / 最近在玩 / 洗码返水横条 /
  负盈利返水横条 / 厂商专区 / 投注榜 —— 这些运营块此前只能改代码
- 每块参数收两项：`limit`（展示数量，封顶 60）与 `layout`（大卡 3 列 / 小卡横滑）。
  **只收真正会被消费的参数**，标题文案不进这里 —— P1-11 的文案覆盖包已经管了，
  两处都能改标题必然对不上
- 下发走 `/slots/homepage` 的 `sections` 字段（挨着既有 `hiddenSections`），
  后台一保存就 `refreshHomepageSelection` 重建，立即生效
- 前端 `HomeContent.tsx` 把 JSX 里写死的板块顺序拆成区块渲染表，按下发顺序渲染。
  **这不是 P3-1 的注册表**：每块仍是自己的一段 JSX，只是可排序、可传参
- 后台新增「首页布局」页（`/homepage-layout`）：升降序、显示隐藏、数量与卡型。
  板块内部的钉位/移除/冻结仍在原「首页板块配置」页，两页各管一层

**兼容与兜底**
- 读配置刻意用 `SELECT *`：219 之前没有那两列，列名写死会让「代码已上线、迁移还没跑」
  的那几秒里**连隐藏配置一起失效**（首页突然冒出运营已关掉的板块）
- 后端不下发 `sections` 时（老缓存 / 接口失败），前端退回自己的 `DEFAULT_HOME_SECTIONS`
  并叠加 `hiddenSections` —— 与改造前行为完全一致
- 默认顺序在前后端各存了一份（`HOME_LAYOUT_SECTIONS` / `DEFAULT_HOME_SECTIONS`），
  两处注释互相点名，加块时必须一起改
- 名次撞车（只可能出现在「只配了一部分区块」的库）让配过的排前面：运营明确表过态
- `params` 是 JSON，读出来只认 `limit` / `layout` 两个字段，其余一律丢弃，
  前端可以直接展开进渲染参数

单测 10 项（顺序、隐藏、部分配置、按币种、参数清洗与封顶），BFF 全量 210 项通过。

### P1-14 套餐可覆盖范围限制 · 2d ✅ 已完成 2026-09-05
`pf_plan_override`（P1-1 已建表，此前无人消费）现已生效，种子见 `007_plan_override_seed.sql`。

- 纳管 5 项：`rebate_rate_pct` / `rebate_max_bonus` / `withdraw_min` / `withdraw_max` /
  `bonus_wager_mult`。**只收录真正影响商务结算的参数** —— 把所有后台配置都纳管
  既做不完，也会让平台后台变成一张永远对不上的表
- **白名单语义**：未登记的 key 一律放行，平台没表态就是不管
- 接线点：`admin/rebate/config`（费率与封顶）、`admin/payment/channels` 增改（提现上下限）、
  `admin/settings` 系统参数（彩金流水倍数）。原有的全局硬边界保留，套餐区间在其上再收窄
- 🔴 **平台库故障时不做校验**，与功能开关的兜底方向一致。反过来（一律拒绝）
  会让一次平台库抖动把所有租户的后台配置页全部锁死
- 自营站走**完全相同**的校验链路（它挂旗舰版，区间给足），不做特例分支：
  特例分支意味着自营站和客户站的校验路径不同，测不出来的问题就藏在那里
- 平台侧改区间会清掉全部租户的缓存 —— 租户数少，全清最省事也最不容易漏
- `min > max` 直接拒：区间反了会让所有取值都被拒，且报错看起来像配置项本身有问题，很难查

**线上验证**（demo1 挂标准版，返水上限 1.5%）
```
写 3.0 → 400 洗码返水费率（%）（L1/slots）不得高于 1.5，当前套餐允许区间 0~1.5
写 1.0 → 保存成功
平台侧 min>max → 400；未知配置项 → 400
```
报错信息带上区间，运营看到就知道该找平台升套餐还是自己改小。


### P1-15 App 出包参数化 · 4d ✅ 已完成 2026-09-05
自营的 `ph` / `id` 两个 flavor 原样保留（已发布，不能动），新增 `tenant` flavor，
参数全部走 `-P`：**接一个客户不用再改 build.gradle**。

- 平台库 `008_tenant_app_build.sql` → `pf_tenant_app`：包名 / 桌面名 / 市场 / 线路组 /
  TG 旁路频道 / 启动屏底色 / 签名引用名 / 版本号。主键带 market —— 自营站就是一租户两个包
- 出包脚本 `scripts/build-tenant-apk.sh <租户代号>`：读平台库 → 生成图标 →
  `cap sync` → `assembleTenant<Debug|Release>`
- 平台控制台「租户详情 → App 出包」维护参数，并给出出包命令
- 图标：传一张 1024 PNG，`sips` 生成五档 mipmap 放进临时目录，用 `-PtenantResDir` 传给 gradle，
  **不覆盖仓库里的默认图标**
- 启动图仍在 web 层（换图免发包），这里只参数化原生那一瞬的底色

**🔴 签名密钥不进平台库。** 库里只有一个引用名 `keystore_ref`，密钥文件与密码放在出包机的
`android/keystore-<ref>.properties`。密钥丢了就再也无法更新已发布的 App，它不该躺在任何一个
能被拖库的地方。引用名的字符集卡死在 `[a-z0-9._-]` —— 它会被拼进文件名，放开路径字符
等于让平台后台能读出包机上的任意文件。

**顺带修掉两个租户 App 起不来的坑**（都不是 UI 问题，是发出去才会发现的那种）：
1. `/app/bootstrap` 的 `market` 白名单写死 PH/ID。租户 App 的 `BuildConfig.APP_MARKET`
   就是这个取值，开在别的市场的客户包**一启动就 400**。改为按该租户开通的市场校验
2. 🔴 线路表兜底会把**自营站的域名**下发给租户 App —— 等于把客户的用户送去别家站点。
   改为兜底只对自营站生效，租户配空了直接 503：宁可这次冷启动失败
3. `saveSiteDomainMappings` 的「每个市场至少留一条线路」写死 PH/ID，
   单市场租户连域名映射都保存不了。改为只校验声明过 App 线路的市场

**实测**（本机 Android SDK 真实出包，不是干跑）
```
assembleTenantDebug → games.demo1.app / versionCode 3 / versionName 1.0.2 / label DEMO1
BuildConfig: APP_MARKET=PH  APP_DOMAINS=demo1.example.com
带 -PtenantResDir 的图标覆盖：构建通过
回归 assemblePhDebug → games.betogo.app / 11 / 1.0.10 / BETOGO，自营包零变化
护栏：租户 release 缺签名密钥 / 缺线路组 / 缺验签公钥，三种都在配置阶段失败
```

> **踩坑**：`versionCode (expr).toInteger()` 被 Groovy 解析成「先用 String 调 versionCode，
> 再对返回值取 toInteger」，配置阶段报一句毫无线索的 `Value is null`。先算成局部变量再赋值。

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
