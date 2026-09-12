# 演示站数据脱敏与重置

给客户演示用的后台（租户 `demo` / 库 `betogo_demo` / `demo-admin.betogo.games`）。
数据来自真实库的采样，**所有个人信息与资金账号在导入前已被替换成不可逆的确定性假值**。

## 🔴 这些脚本一律手动执行，绝不接进部署流程

`deploy-fast.sh` 不会碰这个目录。原因：脚本里有 `DROP DATABASE`，
一旦被部署链路误触发，丢的是演示库，但同一份脚本改错一个库名就是生产事故。

## 流程

```
01-extract.sh    源库 → 临时库 betogo_demo_stage（按采样规则，源库只读）
02-mask.mjs      在临时库上原地脱敏 + 金额缩放 + 重算派生字段
03-verify.mjs    自检：无真实数据残留、外键一致、金额自洽（不通过则拒绝出快照）
04-snapshot.sh   临时库 → 快照文件 demo-snapshot.sql.gz
reset-demo.sh    每日重置：drop → 建库 → 导快照 → 补迁移 → 清 Redis → 时间戳平移
```

前四步按需手动跑（刷新快照时），`reset-demo.sh` 由 cron 每日调用。

## 脱敏原则

**不打码，用确定性假值**：`hash(真值 + salt)` 生成同格式的假数据。

- 打码（`139****8888`）会让后台的搜索、排序、唯一键全部失效，页面一眼是残的
- 确定性映射保证同一个真实用户在用户列表、充值单、注单、客服会话里是**同一个假身份**，
  关联链路完整，演示时点得进去
- salt 不入库、不进快照，哈希不可逆

盐值来自环境变量 `DEMO_MASK_SALT`，每次刷新快照都应换一个新的 —— 同一个盐跨两次
快照会让两批数据可关联比对。

## 金额缩放

**默认 1:1，不缩放** —— 演示库的金额与源库逐字相同。

开关保留在 `DEMO_AMOUNT_SCALE`，要用的时候注意两点：

1. **配置阈值必须跟着一起缩**（VIP 门槛、活动档位、返水门槛、限额）。只缩金额
   不缩阈值，一个 VIP5 用户的累计流水缩完就够不上 VIP5 的门槛，用户详情页里
   等级和流水对不上，点开就穿帮。`02-mask.mjs` 已经是一起缩的。
2. **系数要让配置缩完仍是整数**，建议 0.5：充 1000 送 100 变成充 500 送 50。
   取 0.3 会变成 300 送 30 这种一看就被动过的数。

`SCALE=1` 时脚本直接跳过整个缩放步骤，不会去碰那 132 个 decimal 字段 ——
这不只是省时间，对它们逐个跑全表 UPDATE 会把 MySQL 的 buffer pool 打满。

**比率类字段永远不缩放**：`rate` / `ratio` / `pct` / `percent` / `rtp` / `weight`
以及汇率。它们是比例不是金额。

## 🔴 在生产库上抽取时的注意事项

`01-extract.sh` 对源库只读（`--single-transaction`，不加锁不写入），但**只读不等于无影响**。

一次教训：用 `mysqldump betogo | mysql betogo_demo_stage` 做全量复制，
把测试机的 load 压到 16，SSH 都连不上。同一个实例上同时读写 132 张表，
IO 会直接打满。

所以脚本里做了三件事，在生产上跑之前请确认它们还在：

1. **不用 dump 管道搬数据**，改用同实例内的 `INSERT ... SELECT`，省掉序列化与重新解析
2. **大表带时间窗**（见 `COPY_WINDOWED`），`bg_exchange_rate` 这种 5 万行的历史表只取近 7 天
3. **明细按用户采样**，不是按全表时间窗

即便如此，生产上仍建议：**选低峰时段跑**，并在跑之前先只执行 `COUNT(*)`
估算规模。抽取过程中盯着 `uptime`，load 异常就中断 —— 快照晚一天出无所谓，
影响到真实玩家不行。

## 内存：这台测试机的硬限制

阿里云测试机总内存 1.8GB，`tma-mysql` 容器限额 **512MB**。

这不是理论风险 —— 一次全量复制（132 张表连索引）把 buffer pool 打满，
mysqld 被 OOM killer 干掉，容器自动重启做了 XA crash recovery 才恢复。
数据没丢，但 MySQL 中断了约一分钟。

所以在这台机器上：

- 抽取只走采样，不碰全量
- `SCALE=1` 时跳过缩放，避免 132 个字段的全表 UPDATE
- 灌数据后要实测 demo 库体积。如果它让 MySQL 长期贴着 512MB 跑，
  客人演示时页面会卡 —— 那就得升配，或者把演示站挪到内存更大的机器

---

# 运维手册

## 演示站的构成

| 项 | 值 |
|---|---|
| 租户 | `demo`（`pf_tenant.id=11`，`is_demo=1`） |
| 业务库 | `betogo_demo` |
| 后台域名 | `demo-admin.betogo.games` |
| 账号 | `demoadmin` / `Demo5vjrGarM8g5VShow`（super_admin） |
| 宿主 | 阿里云测试机 `47.84.34.139`，与自营测试站共用一套容器 |
| 快照 | `data/demo/demo-snapshot.sql.gz` |
| 账号种子 | `data/demo/demo-admin-seed.sql` |

`is_demo=1` 这一个标记同时管住两件事：定时任务不遍历它
（`listRunnableTenants`），后台按钮触发的对外调用被拦截（`demoGuard`）。

## 上线剩余步骤

1. **DNS**：`demo-admin.betogo.games` A 记录 → `47.84.34.139`
2. **证书**：
   ```bash
   certbot certonly --webroot -w /www/wwwroot/188facai.com -d demo-admin.betogo.games
   ```
3. **nginx**：`deploy/single-node/nginx-demo-admin.conf`
   复制到 `/www/server/panel/vhost/nginx/`，`nginx -t && nginx -s reload`
4. **定时重置**：把 `deploy/single-node/demo-reset.cron` 加进 crontab

## 刷新快照（换一批演示数据）

盐值每次都要换新的：同一个盐跨两次快照，两批数据能被关联比对。

```bash
export DEMO_MASK_SALT=$(openssl rand -hex 24)
cd /root/workspace/tma-projects

# 1. 抽取（源库只读）
APP_DIR=$PWD SRC_DB=betogo DAYS=30 USERS=500 bash scripts/demo/01-extract.sh

# 2~3. 脱敏与自检都在 bff 容器里跑（宿主机没有 node 和 mysql2）
PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)
E="-e DEMO_MASK_SALT=$DEMO_MASK_SALT -e STAGE_DB=betogo_demo_stage \
   -e MYSQL_HOST=tma-mysql -e MYSQL_PORT=3306 -e MYSQL_USER=root -e MYSQL_PASSWORD=$PW"
podman exec $E tma-bff-node node /tmp/demo-scripts/02-mask.mjs
podman exec $E tma-bff-node node /tmp/demo-scripts/03-verify.mjs   # 不过就不要继续

# 4. 出快照，然后导进演示库
APP_DIR=$PWD STAGE_DB=betogo_demo_stage bash scripts/demo/04-snapshot.sh
APP_DIR=$PWD DEMO_TENANT=demo bash scripts/demo/reset-demo.sh

# 5. 收尾：临时库里是脱敏后的数据，但没必要留着
podman exec tma-mysql mysql -uroot -p"$PW" -e "DROP DATABASE betogo_demo_stage"
```

## 改演示账号密码

改完要重新生成种子，否则第二天重置会还原成旧密码：

```bash
# 在演示后台改完密码后
podman exec tma-mysql mysqldump -uroot -p"$PW" --no-create-info --complete-insert \
  betogo_demo admin_accounts > data/demo/demo-admin-seed.sql
```

## 排查

**演示后台显示的是自营站的数据** —— 最要命的一种故障。
按 Host 链路逐段查：浏览器 → 外层 nginx → web-admin:8085 → bff:3000，
每一跳都必须是 `demo-admin.betogo.games`。另外确认
`TENANT_RESOLVE_STRICT=true`：false 时未登记域名会**静默回落自营站**。

```bash
curl -s -X POST http://127.0.0.1:8085/api/v1/admin/auth/login \
  -H 'Host: demo-admin.betogo.games' -H 'Content-Type: application/json' \
  -d '{"username":"demoadmin","password":"..."}'
```

**演示后台登不进去** —— 多半是重置时管理员没恢复。看
`/var/log/demo-reset.log` 里第 4 步的输出，以及 `demo-admin-seed.sql` 是否还在。

**数据停在前一天** —— 重置失败了。同样看那个日志。

**点某个按钮没反应，返回"演示环境已拦截该操作"** —— 正常。
该操作会打到第三方（TG、支付商、聚合商、AI）或能导出整库备份，
拦截清单在 `apps/bff-node/src/middleware/demo-guard.ts`。
