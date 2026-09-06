FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
# dist 由部署脚本本地构建后通过 volume 挂载到 /usr/share/nginx/html/platform
# （挂到 platform 子目录是因为 vite base 就是 /platform/，资源按该前缀引用）
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/platform/ || exit 1
