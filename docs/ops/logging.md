# 日志与监控（Loki + Grafana）

## 架构

- **bff-node / core-node**：JSON 日志（Pino）→ 容器 stdout → Promtail → Loki
- **Nginx（宝塔）**：`/www/wwwlogs/*188facai*.log` → Promtail → Loki
- **Grafana**：本机 `127.0.0.1:3001`，保留 **7 天**

## 部署（测试/生产单机）

```bash
cd /root/workspace/tma-projects/deploy/single-node
NGINX_LOG_DIR=/www/wwwlogs \
GRAFANA_ADMIN_PASSWORD='你的强密码' \
bash start-observability.sh
```

首次需在服务器执行；之后仅改配置时 `podman compose -f docker-compose.observability.yml up -d`。

应用容器需带日志轮转（`podman-prod-minimal.sh` 已为 bff/core 配置 `json-file` 50m×3）。

## 查看日志

### SSH 隧道打开 Grafana

Grafana **只监听服务器本机** `127.0.0.1:3001`，与 MySQL 隧道（常见 `13306`）是**不同端口**，需在 SSH 里**单独加** `-L 3001:...`，否则本地 `http://127.0.0.1:3001` 会无响应。

**仅 Grafana + Loki（保持终端不要关）：**

```bash
bash scripts/ssh-tunnel-logs.sh
```

或手动：

```bash
ssh -i /Users/yannicky/TMA_FILES/aliyun.pem -o StrictHostKeyChecking=no \
  -L 3001:127.0.0.1:3001 \
  -L 3100:127.0.0.1:3100 \
  -N root@47.84.34.139
```

**MySQL 与 Grafana 同一条 SSH：**

```bash
ssh -i /Users/yannicky/TMA_FILES/aliyun.pem -o StrictHostKeyChecking=no \
  -L 13306:127.0.0.1:13306 \
  -L 3001:127.0.0.1:3001 \
  -N root@47.84.34.139
```

浏览器请用 **http://127.0.0.1:3001**（不要用 `localhost:3001`，Grafana 的 `root_url` 与隧道本地端口一致）。打开后 → Explore → 数据源 **Loki**。

若出现 “failed to load its application files”，多为 `appUrl` 指向了容器内 `:3000`；需设置 `GF_SERVER_ROOT_URL=http://127.0.0.1:3001/` 并重建 `tma-grafana`。

本地若 3001 已被占用，可改本地端口，例如 `-L 13001:127.0.0.1:3001`，浏览器访问 http://127.0.0.1:13001 。

### macOS 登录自动建隧道（LaunchAgent）

在项目根目录执行一次安装（使用 `/Users/yannicky/TMA_FILES/aliyun.pem`，可按需改环境变量）：

```bash
bash scripts/mac/install-grafana-tunnel.sh
```

之后每次**登录 Mac** 会自动执行与手动相同的 SSH 隧道；断线后约 30 秒内重连。日志：`~/Library/Logs/betogo/grafana-tunnel.*.log`。

卸载：`bash scripts/mac/uninstall-grafana-tunnel.sh`

自定义密钥或主机：

```bash
SSH_IDENTITY_FILE=~/path/to.pem DEPLOY_HOST=root@47.84.34.139 bash scripts/mac/install-grafana-tunnel.sh
```

### 常用 LogQL

| 目的 | 查询 |
|------|------|
| BFF 错误 | `{container=~"tma-bff-node.*"} \|= "error"` |
| 按 traceId | `{container=~"tma-bff-node.*"} \|= "你的-uuid"` |
| HTTP 5xx | `{container=~"tma-bff-node.*"} \| json \| status >= 500` |
| core-node | `{container=~"tma-core-node.*"}` |
| Nginx 5xx | `{job="nginx"} \|= " 500 "` |

### 应急：容器实时 tail

```bash
podman logs -f tma-bff-node
podman logs -f tma-core-node
```

或项目脚本：`bash scripts/logs-tail.sh bff`

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LOG_LEVEL` | `info` | bff-node / core-node 日志级别 |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana 登录名 |
| `GRAFANA_ADMIN_PASSWORD` | `changeme` | **生产务必修改** |
| `NGINX_LOG_DIR` | `/www/wwwlogs` | 宝塔日志目录 |

## 与「操作日志」区别

- **操作日志**（web-admin）：`admin_audit_log`，仅管理员人工操作
- **系统日志**（本方案）：应用 + Nginx 运行日志，走 Loki
