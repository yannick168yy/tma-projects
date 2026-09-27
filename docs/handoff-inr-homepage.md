# 交接：印度站（INR）首页板块整改

更新：2026-09-27 17:15

## 背景
印度站首页一直用菲律宾那套板块（slot / perya 为主），不符合印度玩家偏好。调研结论：
- Crash 类（Aviator 等）最热门
- 其次是本土纸牌：Andar Bahar、Teen Patti、7 Up 7 Down、Jhandi Munda
- 板球 / 体育约占市场一半
- 彩色预测（Wingo 类）是本土平台的招牌玩法
- 百家乐、Bingo、捕鱼在印度很冷门

注意：生产上 INR 近 60 天只有 1 个用户、6 局投注，还没有真实数据，下面的配置依据是调研加 INR 游戏库存。

## 已完成（生产已上线，2026-09-27 17:10）
- **`fa157de7`**：后台首页装修支持 INR。
  - 原来 `admin-store.ts` 的 5 处白名单漏了 INR：布局、显隐、冻结一保存就报错；钉选会被当成全币种 `''` 写入。
  - 现在统一成常量 `HOMEPAGE_CONFIG_CURRENCIES`。
  - 已发布生产 bff（两个节点）。生产只读核查过，旧 bug 没有造成过实际损失。
- **`scripts/inr-home-config.mjs`**：INR 首页配置脚本，手动执行，可重复跑，只改 INR。**已在生产和测试执行。**
  - 布局：公告 → Banner → 最近在玩 → 热门 → 体育（上提）→ 真人 → 洗码横条 → 老虎机 → 厂商专区 → 高 RTP（小卡）→ 负盈利横条 → 推荐精选 → 高洗码（小卡）→ 最新上线 → 彩票（小卡）→ 投注榜。
  - 隐藏：Perya、捕鱼、百家乐。
  - 热门：前 8 款钉 Aviator、Andar Bahar、7 Up 7 Down、Teen Patti 20-20、Crash Cricket、Color Prediction、Dragon Tiger、Jhandi Munda。
  - 真人：钉 Super Andar Bahar、Roulette Indian、Emperor Dragon Tiger、Pool Rummy。
  - 老虎机：钉 Golden Taj Mahal、Indian Cash Catcher，排除中国题材。
  - 体育：只留 BTi、Saba、Panda。
  - Color Game、百家乐在热门、推荐精选、高 RTP 中都做了排除。
  - **自动排除**：INR 下有一百多款游戏长期不可用（整个 PlayStar、部分 Evolution 桌台）。热门、推荐精选、高 RTP、高洗码四个板块从全库选品，维护中的游戏会置灰占位。所以脚本在执行时，按 INR 实时状态把"不可用且权重 ≥4000 或 elite 档"的游戏并入这四个板块的排除项。生产这次排除了 166 款，**各板块置灰为 0**。可用状态变了就重跑一次脚本。
- 在生产重跑脚本的命令（发布生产必须先得到用户授权；在 auto 模式下会被分类器拦截，accept edits 模式下可以执行）：
  ```bash
  K="/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem"
  scp -i "$K" scripts/inr-home-config.mjs ubuntu@13.213.107.231:/tmp/ && \
  ssh -i "$K" ubuntu@13.213.107.231 'sudo podman cp /tmp/inr-home-config.mjs tma-bff-node:/app/ && sudo podman exec -w /app tma-bff-node node inr-home-config.mjs; sudo podman exec tma-bff-node rm -f /app/inr-home-config.mjs'
  ```
- main 上另有两个别的会话的 web-tma 提交（`2e465339`、`e6394d98`）仍未上生产。

## 待办
1. **根治置灰（代码）**：自动排除是配置层面的兜底。更合理的做法是在 `buildHomepageSelection` 里区分"临时维护"和"该币种线路长期不可用"，后者像"不支持该币种"一样直接出池。
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
