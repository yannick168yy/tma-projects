FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# dist 由部署脚本本地编译后通过 volume 挂载
EXPOSE 4000
CMD ["node", "dist/index.js"]
