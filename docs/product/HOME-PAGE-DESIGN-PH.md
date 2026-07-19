# 首页设计方案 — Tonplay 结构 × 菲律宾本地化

> **文档状态**：v1.0  
> **参考竞品**：[Tonplay 首页截图](./assets/reference-tonplay-home.png)（结构参考，非品牌抄袭）  
> **菲版概念稿**：[Manila Night 概念图](./assets/home-manila-night-concept.png)  
> **对齐**：[PRODUCT-PLAN.md](./PRODUCT-PLAN.md) · [CLIENT-PRODUCT-DESIGN.md](./CLIENT-PRODUCT-DESIGN.md) · [ART-DESIGN-GUIDE.md](./ART-DESIGN-GUIDE.md)

---

## 一、设计策略总述

### 1.1 借鉴什么 / 不借鉴什么

| 从 Tonplay 借鉴（结构） | 不照搬（差异化） |
|-------------------------|------------------|
| 顶栏：Logo + 币种/余额 + 主 CTA + 头像 | 不用 USD 默认；不用欧式卡通鸭 mascot |
| 横向 **快捷功能卡**（4 格滚动） | 换成：试玩官、邀请红包、GCash 充值、VIP（后期） |
| 大图 **Banner 轮播** | 菲律宾节庆视觉 + 试玩官/百万红包活动 |
| **搜索 + 分类 Tab** 吸顶 | Tab 文案本地化；加 `Hot` / `Perya`（街机） |
| **分区横滑游戏**（History / Slots） | 首屏下再加 **2 列网格「全部游戏」**（PRD 下半屏主列表） |
| 底部 **5 项导航 + 客服 FAB** | MVP 改为 **4 项**（去掉 Sports，菲市场可先不上体育） |
| 深色底 + 高饱和游戏封面 | 配色改为 **「Manila Night」**（见 §三） |

### 1.2 与 PRD 的对应关系

```
PRD「上半屏」          PRD「下半屏」
─────────────────────────────────────────
Logo / 余额 / 充提  →  Tonplay 顶栏 + Top up
快捷导航            →  Tonplay 快捷卡（菲文化文案）
Banner              →  Tonplay 主 Banner
（合并进下半屏顶部）   →  搜索 + 分类 Tab（吸顶）
游戏列表              →  横滑分区 + 双列网格（更快触达）
```

**结论**：采用 Tonplay 的 **信息密度与分区节奏**，在下半屏增加 **双列主网格**，保证「尽可能快速触达游戏」。

---

## 二、首页线框（菲律宾版）

```
┌──────────────────────────────────────────────┐  safe-area-top
│ [Logo]   [₱ PHP ▾]  ₱2,450.00  [Deposit] [👤]│  56px 顶栏
├──────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ →               │  快捷卡 88px 横滑
│ │试玩│ │邀请│ │GCash│ │VIP │               │
│ │官  │ │红包│ │充值 │ │    │               │
│ └────┘ └────┘ └────┘ └────┘                 │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐│  Banner 152px
│ │  FIESTA MILLION · 试玩官 ₱88  [插画:菲]   ││  轮播点 ●○○
│ └──────────────────────────────────────────┘│
├──────────────────────────────────────────────┤  sticky ↓
│ [🔍] [All][Slots][Live][Hot][Perya] →        │  Tab 44px
├──────────────────────────────────────────────┤
│ 🕐 Play Again (Laro ulit)          [‹][›]   │  横滑区 1
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ →               │  大卡 宽~120px
├──────────────────────────────────────────────┤
│ 🔥 Sikat Ngayon (Hot)               [All]   │  横滑区 2
│ ┌────┐ ┌────┐ ┌────┐ →                       │
├──────────────────────────────────────────────┤
│ ▦ All Games — grid                           │  双列网格 主列表
│ ┌──────┐ ┌──────┐                            │
│ │ game │ │ game │                            │
│ └──────┘ └──────┘                            │
│      ... scroll ...                          │
├──────────────────────────────────────────────┤
│ [Home] [Wallet] [Promo●4] [Menu]        (🎧)│  底栏 56px + FAB
└──────────────────────────────────────────────┘  safe-area-bottom
```

---

## 三、视觉风格：「Manila Night」（菲律宾主题）

在原「Midnight Emerald」基础上，增加 **菲律宾市场识别色**，但 **避免整页像国旗**（低俗、政治敏感）。

### 3.1 色板

| Token | Hex | 来源/用途 |
|-------|-----|-----------|
| `bg.base` | `#0A0E17` | 深夜 MAN 街头感 |
| `bg.surface` | `#141B2D` | 卡片底 |
| `ph.blue` | `#1E3A8A` | 信任、导航选中（菲旗蓝弱化） |
| `ph.gold` | `#FBBF24` | 奖金、HOT、Banner 强调（金穗/幸运） |
| `ph.coral` | `#F97316` | 促销、邀请红包（热带活力） |
| `cta.primary` | `#2563EB` | **Deposit / 主按钮**（参考 Tonplay 蓝，菲用户熟悉「行动蓝」） |
| `cta.success` | `#10B981` | 到账、成功（保留翡翠绿） |
| `text.primary` | `#F8FAFC` | 主文字 |

**原则**：主 CTA 用 **行动蓝**（与 Tonplay 一致，转化成熟）；红包/节日用 **金 + 珊瑚**；避免大面积纯红。

### 3.2 图形与纹样（轻量）

| 元素 | 建议 | 避免 |
|------|------|------|
| Banner 背景 | 抽象 **吉普尼条纹**、微弱 **编织纹（Banig）**、金色光斑 | 直接印国旗、政治人物 |
| 节日活动 | Sinulog 舞彩带抽象形、圣诞/新年 **Pasko** 主题（按运营日历） | 宗教符号过重 |
| 空态/红包 | **卡拉宝（Carabao）** 或 **菲律宾鹰（简化卡通）** 吉祥物 | 欧美鸭子、圣诞老人翻版 |
| 图案密度 | 仅 Banner/活动页；**游戏区保持干净** | 满屏花纹干扰封面 |

### 3.3 字体与文案语言

| 场景 | 语言 |
|------|------|
| 余额、充提、按钮 | **EN**（短） + 金额 **₱** |
| 快捷卡副标题 | **FIL** 一句（如 `Kumuha ng bonus`） |
| Tab | EN：`All` `Slots` `Live` `Hot`；可加 FIL tooltip |
| 分区标题 | 双语：`Play Again` / `Laro ulit` |

---

## 四、区块规格（对照 Tonplay → 菲版）

### 4.1 顶栏（Header）

| Tonplay | 菲版方案 |
|---------|----------|
| Tonplay Logo | **项目 Logo**（建议含轻微金色线条） |
| USD ▾ + 2,49$ | **₱ PHP ▾** 默认；点击切换 `PHP` / `USDT` |
| Top up 蓝钮 | **`Deposit`** 主色 `#2563EB`；旁可加小号 **`Withdraw`** ghost |
| 头像 + 红点 | TG 头像；红点 = 未读消息/待领红包 |

**余额展示**

```
₱ 2,450.00          ← 28px bold, font-display
USDT 12.50 ›        ← 12px 次要，点击进入钱包
```

### 4.2 快捷功能卡（横滑，4+）

替代 Tonplay 的 Bonuses / Cashback / VIP / Crypto：

| 卡片 | 视觉 | 跳转 | MVP |
|------|------|------|-----|
| **Trial Player** 试玩官 | 金底 + 红包图标；角标 `₱88` | 试玩官活动页 | ✅ |
| **Invite & Earn** 邀请 | 珊瑚底 + 双人图标；`Both get ₱` | 邀请有礼 | ✅ |
| **GCash Deposit** | 白底 + **官方 GCash 蓝** Logo | 充值页预选 GCash | ✅ |
| **USDT** | 深色 + USDT 标 | 充值页预选链 | ✅ |
| VIP | 奖杯 + 等级 | VIP 页 | P2 |

卡片尺寸：**宽 100–108px，高 88px**，圆角 16px，与 Tonplay 一致。

### 4.3 主 Banner

| 项 | 说明 |
|----|------|
| 尺寸 | 宽 100% − 32px margin，高 **152–168px**，圆角 16px |
| 内容 | 运营配置：试玩官、邀请裂变、厂商 Million Drops |
| 视觉 | 左文右图；吉祥物持 **金袋 / 扑克筹码**；背景 `gradient` 蓝→金 |
| 指示器 | 左下圆点；自动轮播 5s |
| 文案示例 | `FIESTA MILLION` / `Paid Trial Player — Claim ₱88` |

### 4.4 搜索 + 分类 Tab（吸顶）

| 元素 | 行为 |
|------|------|
| 搜索钮 | 44×44；P1 打开搜索页；MVP 可 toast `Coming soon` |
| Tab | `All` `Slots` `Live` `Hot` `Perya` |
| 选中态 | 蓝色下划线 + 图标填色（对齐 Tonplay） |
| 吸顶 | 滚动过 Banner 后 `position: sticky; top: 0` + `backdrop-blur` |

**Perya**：菲律宾街头游乐/街机文化词，用于 **街机/小游戏** 分类，本地化差异点。

### 4.5 游戏内容区（三层）

#### 层 1：Play Again（对应 Game history）

- 仅当用户有最近记录时显示。  
- **横滑大卡**（宽 120px，高 160px），与 Tonplay 竖卡一致。  
- 右侧 `‹ ›` 或手势横滑。

#### 层 2：Sikat Ngayon / Hot（运营配置热门）

- 横滑中卡；角标 `HOT` 金色。  
- 右侧 `All` 进入该分类筛选后的网格。

#### 层 3：All Games 双列网格（PRD 核心）

- **2 列**，封面 1:1，间距 12px。  
- 标签：`DEMO` / `维护` / 厂商名小字。  
- **点击即启动**（游戏锁 → Loading）。  
- 上拉加载更多。

> Tonplay 以横滑为主；菲版保留横滑 **提升精致感**，用网格 **保证首屏下即可点玩**。

### 4.6 底部导航 + 客服 FAB

| 项 | Tonplay | 菲版 MVP |
|----|---------|----------|
| 项数 | 5 | **4** |
| 项 1 | Cashier | **Wallet**（钱包图标）→ 钱包页 |
| 项 2 | Sports | **去掉**（无体育 MVP） |
| 项 3 | Bonuses | **Promo**（礼物图标 + 红点待领数） |
| 项 4 | 竞彩 | **Home**（当前页高亮） |
| 项 5 | Menu | **Menu** → 我的/设置抽屉 |
| FAB | 耳机客服 | 保留；`#2563EB` 圆形右下角 |

**与 PRD「首页即大厅」**：底栏 **Home 即当前大厅**，不设独立 竞彩 Tab；Promo 聚合试玩官+邀请。

---

## 五、菲律宾文化落地清单

| 维度 | 落地方案 |
|------|----------|
| **支付信任** | 快捷卡露 GCash/Maya；充值页优先展示本地 e-wallet Logo |
| **促销语言** | `Jackpot`, `Panalo`（赢了）, `Suwerte`（幸运）用于 HOT 角标 |
| **社交裂变** | 邀请卡强调 `Both you & friend get ₱XX` — 菲市场重互惠 |
| **试玩官** | 英文主标题 + FIL `Subok na, may premyo`；金额用 ₱ |
| **Responsible gaming** | 底栏 Menu 内 `18+` `Play responsibly`；非首页首屏 |
| **色彩心理** | 蓝=信任（GCash 同源认知）；金=赢钱；珊瑚=节日喜庆 |
| **节日运营** | 后台 Banner 模板：圣诞 Pasko、新年、Sinulog（1 月）、独立日（谨慎简约） |

---

## 六、状态与交互（首页专属）

| 状态 | UI |
|------|-----|
| 冷启动 | 先渲染 **All Games 骨架网格** + Tab；顶栏余额 skeleton |
| 下拉刷新 | 余额 + 游戏列表 + Hot 区 |
| 维护 | 游戏卡片蒙层 `Under maintenance` |
| 试玩 | 卡片角标 `DEMO` 蓝色 |
| 待领红包 | Promo Tab 红点 + 试玩官卡 pulse 动画（轻） |
| 游戏锁 | 点击游戏 → Dialog（见 CLIENT 文档） |

---

## 七、组件映射（Vue + Tailwind）

| 组件 | 说明 |
|------|------|
| `HomeHeaderPh` | Logo、币种切换、余额、Deposit、头像 |
| `QuickActionScroll` | 4 快捷卡横滑 |
| `HeroBannerCarousel` | 菲节日模板 slot |
| `CategoryTabsSticky` | 搜索 + Tab 吸顶 |
| `GameRowCarousel` | Play Again / Hot |
| `GameGrid` | 双列主列表 |
| `BottomNavPh` | 4 项 + badge |
| `SupportFab` | 客服 |

---

## 八、与 Tonplay 差异一览（给设计/研发）

| # | Tonplay | 本项目菲版 |
|---|---------|------------|
| 1 | USD | **PHP 默认** + USDT |
| 2 | 鸭子吉祥物 | **本地吉祥物**（卡拉宝/鹰） |
| 3 | Crypto 快捷入口 | **GCash + USDT** |
| 4 | Sports Tab | **无**（MVP） |
| 5 | 纯横滑游戏 | 横滑 + **双列网格** |
| 6 | Cashback/VIP 为主 | **试玩官 + 邀请红包** 为主 |
| 7 | 欧美促销视觉 | **Banig/Jeepney 抽象纹 + 金蓝配色** |
| 8 | 佣金体系 | **无佣金**，仅红包 |

---

## 九、交付与下一步

| 交付物 | 负责人 |
|--------|--------|
| Figma 首页 1 屏高保真（Manila Night） | UI 设计 |
| Banner 模板 3 套（试玩/邀请/厂商） | 运营 + 设计 |
| GCash/Maya 官方 Logo 包 | 运营合规 |
| Vue 首页静态原型 | 研发 / Cursor |

**建议品牌名方向**（可选）：避免 Ton 链联想；可用 `PinasPlay` / `BayanWin` / 自定 — Logo 用金色线条 + 深蓝底。

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-23 | Tonplay 结构 + Manila Night 菲版首页 |
