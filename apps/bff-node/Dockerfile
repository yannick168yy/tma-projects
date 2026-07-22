FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# mariadb-client 提供 mysqldump，供后台「立即备份」使用
RUN apk add --no-cache mariadb-client

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# dist 由部署脚本本地编译后通过 volume 挂载
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
