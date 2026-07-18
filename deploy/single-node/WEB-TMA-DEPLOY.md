# web-tma 客户端 — 阿里云单机部署

静态 Vue 客户端通过 **Docker + Nginx** 发布，适合新加坡 ECS（2C4G 即可）。

## 前置条件

| 项 | 说明 |
|----|------|
| 系统 | Ubuntu 22.04 / Alibaba Cloud Linux 3 等 |
| 软件 | Docker（脚本可尝试自动安装） |
| 安全组 | 放行 **80** 或你映射的端口（默认 **8080**） |
| HTTPS | Telegram Mini App 生产环境建议绑定域名并配置 TLS（见下文） |

## 方式 A：本机一键推送到服务器（推荐）

在**你本机**仓库根目录：

```bash
chmod +x deploy/single-node/deploy-web-tma.sh

export DEPLOY_HOST=root@你的公网IP    # 或 ubuntu@...
export DEPLOY_DIR=/opt/tma-projects
export WEB_TMA_PORT=8080              # 对外端口，可改为 80
export SSH_IDENTITY_FILE=~/Downloads/your.pem   # 阿里云下载的密钥

./deploy/single-node/deploy-web-tma.sh
```

浏览器访问：`http://公网IP:8080`

需已配置 **SSH 公钥登录**（`ssh root@公网IP` 能免密进入）。

## 方式 B：在服务器上手动构建

```bash
git clone https://github.com/yannick168yy/tma-projects.git
cd tma-projects
docker compose -f deploy/single-node/docker-compose.web-tma.yml up -d --build
```

## 方式 C：不用 Docker，仅 Nginx 托管 dist

```bash
cd apps/web-tma
npm ci && npm run build
sudo mkdir -p /var/www/tma-web
sudo cp -r dist/* /var/www/tma-web/
# 将 apps/web-tma/nginx/default.conf 拷到 /etc/nginx/conf.d/tma-web.conf
# 修改 root 为 /var/www/tma-web
sudo nginx -t && sudo systemctl reload nginx
```

## HTTPS（Telegram WebApp）

1. 域名 A 记录指向 ECS 公网 IP  
2. 安全组放行 **443**  
3. 安装证书（示例 Certbot）：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

4. 在 [@BotFather](https://t.me/BotFather) 将 Mini App URL 设为 `https://your-domain.com`

## 更新发布

```bash
export DEPLOY_HOST=root@你的公网IP
./deploy/single-node/deploy-web-tma.sh
```

脚本会 `rsync` 最新代码并在服务器上 `docker compose up -d --build`。

## 故障排查

- **无法访问**：检查阿里云安全组 / 本机 `ufw` 是否放行端口  
- **容器未起**：`ssh` 登录后 `docker logs tma-web-tma`  
- **404 刷新**：确认 Nginx 使用 `try_files ... /index.html`（已包含在默认配置）
