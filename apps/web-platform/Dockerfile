FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
# dist 由部署脚本本地构建后通过 volume 挂载到 /usr/share/nginx/html
# （生产构建的 vite base 是 /，资源按根路径引用）
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
