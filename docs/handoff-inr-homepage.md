# 交接：印度站（INR）首页板块整改

更新：2026-09-27 15:10

## 背景
印度站首页一直用菲律宾那套板块（slot / perya 为主），不符合印度玩家偏好。调研结论：
- Crash 类（Aviator 等）最热门
- 其次是本土纸牌：Andar Bahar、Teen Patti、7 Up 7 Down、Jhandi Munda
- 板球 / 体育约占市场一半
- 彩色预测（Wingo 类）是本土平台的招牌玩法
- 百家乐、Bingo、捕鱼在印度很冷门

注意：生产上 INR 近 60 天只有 1 个用户、6 局投注，还没有真实数据，下面的配置依据是调研加 INR 游戏库存。

## 已完成
- **`fa157de7`**：后台首页装修支持 INR。
  - 原来 `admin-store.ts` 的 5 处白名单漏了 INR：布局、显隐、冻结一保存就报错；钉选会被当成全币种 `''` 写入。
  - 现在统一成常量 `HOMEPAGE_CONFIG_CURRENCIES`。
  - 已 push，已部署测试环境。**生产未发布。**
- **`f0540635`**：新增 `scripts/inr-home-config.mjs`，INR 首页一次性配置脚本，手动执行，可重复跑，只改 INR。
  - 布局：体育上提；隐藏 Perya、捕鱼、百家乐；高 RTP、高洗码、彩票改成小卡横滑。
  - 热门：前 8 款钉印度玩法，排除 INR 下置灰或偏菲律宾的游戏。
  - 真人、老虎机、体育：各有钉选和排除。
  - 已在测试环境执行，结果正确，PHP 首页不受影响。
- 生产只读核查：没有 INR 钉选误写的记录，旧 bug 没有造成过实际损失。

## 待办
1. **生产发布与配置（需要用户在自己的终端执行）**。auto 模式分类器会拦截生产发布，连 curl 生产域名也会拦。
   ```bash
   FORCE=1 bash deploy/single-node/deploy-prod.sh bff
   K="/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem"
   scp -i "$K" scripts/inr-home-config.mjs ubuntu@13.213.107.231:/tmp/ && \
   ssh -i "$K" ubuntu@13.213.107.231 'sudo podman cp /tmp/inr-home-config.mjs tma-bff-node:/app/ && sudo podman exec -w /app tma-bff-node node inr-home-config.mjs; sudo podman exec tma-bff-node rm -f /app/inr-home-config.mjs'
   ```
   - 必须先发 bff 再跑脚本，否则会报"currency 必须为 PHP、IDR 或 USDT"。
   - 发布前生产停在 `85917af1`（迁移 238）。main 上另有两个别的会话的 web-tma 提交（`2e465339`、`e6394d98`）没有上生产，发 bff 不会带上它们。
2. **P1：新增两个板块**（需先和用户确认板块名和选品规则）。
   - `crash`（Crash & Instant Win）：Aviator、Crash Cricket、Chicken Road、Mines、Plinko、Limbo 等。
   - `indianCards`（Indian Card Games）：Andar Bahar、Teen Patti、7 Up 7 Down、Jhandi Munda、Dragon Tiger、Rummy、Color Prediction。
   - 要改的地方：
     - bff `sg-game.service.ts`：`HOME_LAYOUT_SECTIONS` 加 key；`HomepageSelection` 和 `buildHomepageSelection` 加选品。建议用"游戏名关键词池 + pickWeightTop"，照样支持钉选和排除。
     - bff `admin-store.ts`：`HOMEPAGE_SECTION_KEYS` 加 key。
     - web-tma：`components/home/gameSections.tsx`、`components/home/blockOrder.ts`，以及 `HomeContent.tsx` 里的 `emptyHomepage`、`setHomepageGames`。
     - i18n：en、hi 两套文案。
   - Teen Patti 的 siteCategory 是 `poker`，Aviator 的是 `perya`，按分类选不到，只能按关键词。
   - 表里"无行 = 显示"：要加迁移，在 PHP、IDR、USDT 下把新板块插成 `hidden=1`。迁移号先查测试机已执行的号，再看 `git log -3 -- infra/database`。
   - 做完后更新 `scripts/inr-home-config.mjs`，把新板块排进 INR 的首屏（最近在玩之后）。
3. **厂商专区 Tab 改成按市场配置**。现在写死在 `HomeContent.tsx:41` 的 `PROVIDER_ZONE`。印度建议的顺序：JILI、Spribe、Evolution、Pragmatic、King Midas、PG。
4. **板球 / IPL Banner**：需要先准备图片，再在后台「首页装修」里按站点上传。
5. **P2**：
   - 启动埋点加上"来源板块"，2–4 周后按各板块点击率调整。
   - 游戏权重目前全局共用，考虑按币种设权重。

## 参考
- 测试环境 API：`https://www.188facai.com/api/v1/slots/homepage?currency=INR`、`/api/v1/slots/games?search=...&currency=INR`
- 测试和生产的游戏库存、维护状态不完全一致：测试环境 Evolution 真人桌在维护，也没有 Chicken Road(568Win)。
