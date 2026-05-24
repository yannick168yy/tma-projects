# BetoGo 服务器配置要求（按部署场景）

> 基于仓库内 Podman/Docker **memory limit**、进程参数与现网 2C2G 实践整理。  
> 更新：2026-05-24 · 对齐 `podman-prod-minimal.sh` / `podman-prod-full.sh` / `docker-compose.yml`

---

## 1. 组件与脚本对照

| 组件 | 镜像 | 当前生产默认 | `podman-prod-full.sh` | 目标架构（真 Spring Core） |
|------|------|:------------:|:---------------------:|:--------------------------:|
| web-tma | nginx + 静态 | ✅ | ✅ | ✅ |
| bff-node | Node 20 | ✅ | ✅ | ✅ |
| redis | redis:7-alpine | ✅ | ✅ | ✅ |
| mysql | mysql:8.0（容器 `betogo`） | ✅ | ✅ | ✅ |
| nacos | nacos-server slim | ❌ | ✅ | 可选 |
| rabbitmq | rabbitmq:3 management | ❌ | ✅ | ✅ |
| core-java | Spring Boot | ❌ | ✅（占位 ~128MB） | ✅（512MB～1GB+） |

**宿主机常见附加**：Linux、**宝塔 Nginx/SSL**（反代 `https://域名` → BFF `:3000`、Web `:8080`）。容器 MySQL 与宝塔 MySQL（`:3306`）为两套，全容器方案不必再开宝塔库。

**相关脚本 / Compose**

| 场景 | 入口 |
|------|------|
| 生产推荐（4 容器 + MySQL） | `deploy/single-node/podman-prod-minimal.sh` |
| 生产全量（7 容器） | `deploy/single-node/podman-prod-full.sh` |
| Compose 生产 | `deploy/single-node/docker-compose.prod.yml` |
| Compose 全量 | `deploy/single-node/docker-compose.prod.full.yml` |
| 本地默认 | `docker compose` + `scripts/local-deploy.sh` |
| 本地全量 | `docker compose --profile full` |

---

## 2. 容器内存上限（脚本内 cgroup limit）

### 2.1 当前生产栈（minimal，4 容器）

| 服务 | 上限 | 关键进程参数 |
|------|------|----------------|
| MySQL | 256 MB | `innodb_buffer_pool_size=64M` |
| Redis | 96 MB | `maxmemory 64mb` |
| bff-node | 192 MB | Node 单进程 |
| web-tma | 64 MB | nginx 静态 |
| **合计** | **≈ 608 MB** | |

来源：`deploy/single-node/podman-prod-minimal.sh`

### 2.2 全量镜像（full，7 容器）

| 服务 | 上限 |
|------|------|
| Nacos | 384 MB（JVM `Xmx=256m`） |
| MySQL | 384 MB |
| RabbitMQ | 256 MB |
| core-java | 128 MB（占位，非完整 Spring） |
| bff-node | 192 MB |
| Redis | 96 MB |
| web-tma | 64 MB |
| **合计** | **≈ 1.50 GB** |

来源：`deploy/single-node/podman-prod-full.sh`

### 2.3 本地开发（compose，上限更松，非生产基准）

| 服务 | compose limit（约） |
|------|---------------------|
| MySQL | 512 MB |
| Redis | 192 MB |
| bff-node | 256 MB |
| nacos（profile full） | 512 MB |
| rabbitmq（profile full） | 384 MB |
| core-java（profile full） | 512 MB |

来源：根目录 `docker-compose.yml`

---

## 3. 宿主机额外占用（须预留）

| 类别 | 大致范围 | 说明 |
|------|----------|------|
| Linux + 基础服务 | 300～500 MB | 无桌面最小化系统 |
| 宝塔 + Nginx | 300～800 MB | 仅 Nginx 反代偏低；面板常开偏高 |
| Podman/容器运行时 | 50～150 MB | 每容器少量 shim |
| `podman build` 部署峰值 | +500 MB～1 GB | 与业务容器同机时抢内存 |
| 文件缓存 / 连接突发 | 10～20% | MySQL、Redis 尖峰 |

**估算公式**

```text
建议物理内存 ≥ 容器 limit 合计 × (1.25～1.4) + 宿主机(宝塔+Nginx+OS) + 512MB 余量
```

---

## 4. 分场景最低与推荐配置

### 场景 A：当前生产（minimal + 容器 MySQL）

**组成**：web-tma、bff-node、redis、tma-mysql（`BFF_STORAGE=mysql`），无 Nacos / RabbitMQ / 真 Core。

| 项 | 最低（能跑） | 推荐（稳定） |
|----|--------------|--------------|
| 内存 | **2 GB** | **4 GB** |
| vCPU | 2 核 | 2 核 |
| 系统盘 | 40 GB | 60 GB |
| Swap | 2 GB（建议开） | 4 GB |

| 项 | 说明 |
|----|------|
| 现网参考 | 阿里云 2C2G 可跑；部署构建、尖峰时易紧 |
| 磁盘 | 镜像约 1～1.5 GB；MySQL 数据随业务增长 |
| 网络 | 公网 443；容器端口可仅 `127.0.0.1`，由宝塔反代 |
| 带宽 | 早期 TMA：**1～5 Mbps** 通常足够 |

---

### 场景 B：全部镜像配齐（full 脚本，7 容器）

**组成**：场景 A + Nacos + RabbitMQ + core-java（占位 Jar）。

| 项 | 最低（勉强） | 推荐（稳定） |
|----|--------------|--------------|
| 内存 | **4 GB** | **8 GB** |
| vCPU | 2 核 | **4 核** |
| 系统盘 | 60 GB | 80 GB |
| Swap | 4 GB | 4 GB |

| 项 | 说明 |
|----|------|
| 风险 | 2 GB 宿主机 + 宝塔 + limit 合计 ~1.5 GB → 易 OOM（Nacos 曾不稳定） |
| 磁盘 | 镜像合计约 **2～3 GB**；Nacos/RabbitMQ 数据卷各约 100～500 MB |
| CPU | 多 JVM/Erlang 同时启动，**4 核** 明显优于 2 核 |

---

### 场景 C：目标完整业务（真 Spring core-java + MQ 消费）

**组成**：架构图全链路；core-java 需单独调高 limit（通常 **512 MB～1 GB+**），非当前 128 MB 占位。

| 项 | 最低 | 推荐 |
|----|------|------|
| 内存 | **8 GB** | **16 GB** |
| vCPU | 4 核 | 4～8 核 |
| 系统盘 | 80 GB SSD | 100 GB+ SSD |
| Swap | 4 GB | 4～8 GB |

| 项 | 说明 |
|----|------|
| 容器 limit 合计 | 约 **2～2.5 GB+**（含真 Java） |
| 适用 | 游戏回调、账变 MQ、多实例扩展前的小规模生产 |

---

### 场景 D：本地开发（本机 Docker）

**组成**：默认 `mysql + redis + bff + web`；`--profile full` 再加 nacos、rabbitmq、core-java。

| 项 | 最低 | 推荐 |
|----|------|------|
| 内存 | 8 GB | 16 GB |
| vCPU | 4 核 | 4 核 |
| 系统盘 | 40 GB 可用 | 60 GB+ |

| 项 | 说明 |
|----|------|
| 注意 | compose 内存上限高于生产，**勿**直接当作云上最低配 |

---

## 5. 总览对照表

| 部署形态 | 容器数 | 容器 limit 合计 | 宿主机内存（最低 / 推荐） | vCPU（最低 / 推荐） | 系统盘 |
|----------|--------|-----------------|---------------------------|---------------------|--------|
| **A 当前生产** | 4 | ~608 MB | **2 GB / 4 GB** | 2 / 2 | 40 / 60 GB |
| **B 全量脚本** | 7 | ~1.5 GB | **4 GB / 8 GB** | 2 / 4 | 60 / 80 GB |
| **C 目标完整业务** | 7+ | ~2～2.5 GB+ | **8 GB / 16 GB** | 4 / 4～8 | 80 / 100+ GB |
| **D 本地 dev full** | 6～7 | ~2.5 GB+（上限松） | 8 GB / 16 GB | 4 / 4 | 40 / 60 GB |

---

## 6. 磁盘与网络（通用）

### 磁盘

| 用途 | 大约 |
|------|------|
| 全量镜像（7 个） | 2～3 GB |
| 仅 minimal 镜像 | 1～1.5 GB |
| MySQL `betogo` 数据 | 起步百 MB，随用户/订单增长 |
| 日志 + 构建缓存 | 预留 5～15 GB |

### 网络

| 项 | 要求 |
|----|------|
| 公网 | HTTPS **443**（Telegram Mini App、Google OAuth） |
| 对内 | BFF `127.0.0.1:3000`，Web `0.0.0.0:8080`（或经 Nginx） |
| MySQL | 建议仅 `127.0.0.1:13306`，不对公网开放 |

---

## 7. 宝塔与同机禁忌

| 组合 | 2 GB | 4 GB | 8 GB |
|------|:----:|:----:|:----:|
| 场景 A（4 容器）+ 仅 Nginx | ⚠️ 紧 | ✅ | ✅ |
| 场景 B（7 容器）+ 宝塔面板 | ❌ | ⚠️ | ✅ |
| 场景 B + 宝塔 MySQL 同机 | ❌ | ❌ | ⚠️ |
| 场景 C（真 Java）同机全栈 | ❌ | ❌ | ⚠️ 建议拆机或 16G |

**结论摘要**

- **2C2G**：仅适合 **场景 A**；不适合「全部镜像配齐」。
- **全部镜像（场景 B）**：物理内存至少 **4 GB**，稳定建议 **8 GB**。
- 配置中心：生产默认可用 **`.env`**，不必同机 Nacos（见 `V0.2-OPS-INFRA-DECISIONS.md`）。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-24 | 初版：A/B/C/D 场景、容器 limit、磁盘网络、宝塔对照 |
