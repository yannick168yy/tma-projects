# 由 issue-tenant-certs.sh 生成，勿手工编辑 —— 下次签发会整份覆盖。
# 域名 __DOMAIN__ · 租户 __TENANT_CODE__ · 用途 __PURPOSE__
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    # ACME HTTP-01 挑战必须排在跳转前面：放到 301 后面会让 certbot 永远拿不到挑战文件
    location ^~ /.well-known/acme-challenge/ {
        root __WEBROOT__;
        default_type "text/plain";
    }

    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name __DOMAIN__;

    ssl_certificate     /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    # 续期同样走 HTTP-01：certbot renew 时 80 端口那份也在，这里留着不影响
    location ^~ /.well-known/acme-challenge/ {
        root __WEBROOT__;
        default_type "text/plain";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        # Host 必须透传：租户是靠它解析的，改写成 upstream 名字会让请求落到自营站
        proxy_pass http://127.0.0.1:__UPSTREAM_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_cache off;
    }
}
