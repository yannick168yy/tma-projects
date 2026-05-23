# C 端美术与 UI 设计指南

> **文档状态**：v1.0  
> **配合**：[CLIENT-PRODUCT-DESIGN.md](./CLIENT-PRODUCT-DESIGN.md) · [PRODUCT-PLAN.md](./PRODUCT-PLAN.md)  
> **实现**：Vue 3 + Tailwind CSS（设计令牌 → `tailwind.config`）

---

## 一、设计定位

### 1.1 品牌气质

| 维度 | 方向 |
|------|------|
| 市场 | 菲律宾在线娱乐用户，熟悉 GCash、本地促销风格 |
| 气质 | **活力、可信、略奢华但不土气** |
| 参考调性 | 深色博彩界面 + 金色/翡翠绿点缀（财富、幸运）；避免廉价霓虹过载 |
| 与 TG 关系 | **融入 Telegram 暗色主题**，而非突兀独立 App |

### 1.2 设计关键词

`Trusted` · `Fast` · `Lucky` · `Clear` · `Native to TG`

### 1.3 避免

- 过度闪烁、全屏刺眼渐变（疲劳 + 低端感）  
- 与 TG 浅色/深色主题严重违和  
- 过小点击区域（最小 44×44pt）  
- 英文美术字堆砌无 FIL 计划  

---

## 二、视觉风格（Style Direction）

### 2.1 推荐主方案：**「Manila Night」**（首页 · 菲律宾）

> 结构参考 Tonplay；视觉见 [HOME-PAGE-DESIGN-PH.md](./HOME-PAGE-DESIGN-PH.md)。

深色底 + **行动蓝主 CTA**（贴近 Tonplay 转化习惯与 GCash 信任蓝）+ **金色/珊瑚** 做促销与红包。

```
背景层 ── #0A0E17 ~ #141B2D
主 CTA  ── #2563EB（Deposit / 主按钮）hover #3B82F6
信任蓝  ── #1E3A8A（Tab 选中、链接）
奖励金  ── #FBBF24（HOT、红包、Banner）
热带珊瑚 ── #F97316（邀请、试玩官卡片）
成功绿  ── #10B981（到账、正向金额）
文字    ── #F8FAFC / #9CA3AF / #6B7280
```

### 2.2 备选方案（运营 A/B 时可切换令牌）

| 方案 | 主色 | 适用 |
|------|------|------|
| A **Manila Night** | 蓝 + 金 + 珊瑚 | **首页默认（PH）** |
| B Midnight Emerald | 绿 + 金 | 钱包/提现等「资金可信」子页可沿用 |
| C Clean Light | 白底 + 蓝 | TG 浅色主题用户 |

**MVP 首页实现 A**；子页可与 A 统一，或通过 CSS 变量切换。

---

## 三、设计令牌（Design Tokens）

### 3.1 颜色 — 语义色板

| Token | Hex | 用途 |
|-------|-----|------|
| `bg.base` | `#0B0F1A` | 页面底 |
| `bg.surface` | `#121826` | 区块底 |
| `bg.elevated` | `#1A2235` | 卡片、Bottom Sheet |
| `bg.overlay` | `rgba(0,0,0,0.6)` | 遮罩 |
| `brand.primary` | `#10B981` | 主 CTA、链接 |
| `brand.primary-hover` | `#34D399` | 按下态 |
| `brand.secondary` | `#F59E0B` | 红包、HOT、促销 |
| `text.primary` | `#F9FAFB` | 标题、余额 |
| `text.secondary` | `#9CA3AF` | 说明 |
| `text.muted` | `#6B7280` | 占位 |
| `border.default` | `#2A3548` | 分割线 |
| `status.success` | `#22C55E` | 成功、到账 |
| `status.warning` | `#F59E0B` | 审核中 |
| `status.error` | `#EF4444` | 失败、余额负向 |
| `status.info` | `#3B82F6` | 提示、维护 |

### 3.2 渐变（慎用）

| 名称 | 值 | 用途 |
|------|-----|------|
| `gradient.hero` | `linear-gradient(135deg, #121826 0%, #0F766E 100%)` | Banner 底、活动头图 |
| `gradient.cta` | `linear-gradient(90deg, #059669, #10B981)` | 主按钮 |
| `gradient.gold` | `linear-gradient(90deg, #D97706, #FBBF24)` | 红包按钮 |

**规则**：单屏最多 1 处强渐变；游戏卡片封面不用渐变遮罩压字。

### 3.3 字体

| 角色 | 字体栈 | 字号 |
|------|--------|------|
| 余额数字 | `DM Sans`, `Inter`, system-ui | 28–32px / bold |
| 标题 | `Inter`, system-ui | 18–20px / semibold |
| 正文 | `Inter`, system-ui | 14–16px / regular |
| 辅助 | 同上 | 12px / regular |
| 标签 | 同上 | 10–11px / medium uppercase |

> Google Fonts：`Inter` + `DM Sans`（数字）；若需 FIL 友好，正文可换 `Noto Sans`。

### 3.4 圆角与阴影

| Token | 值 |
|-------|-----|
| `radius.sm` | 8px |
| `radius.md` | 12px（卡片默认） |
| `radius.lg` | 16px（Sheet） |
| `radius.full` | 9999px（Chip、头像） |
| `shadow.card` | `0 4px 24px rgba(0,0,0,0.25)` |
| `shadow.glow` | `0 0 20px rgba(16,185,129,0.25)` 主按钮可选 |

### 3.5 间距（4px 基准）

`4 / 8 / 12 / 16 / 20 / 24 / 32` — 页面左右边距 **16px**；卡片间距 **12px**。

### 3.6 图标

- 风格：**线性 2px**，圆角端点；激活态可填色。  
- 库推荐：**Lucide** 或 **Heroicons**（与 Tailwind 生态一致）。  
- 支付渠道：**官方 Logo**（GCash、Maya、TG）— 用品牌资源，勿手绘山寨。

---

## 四、核心组件视觉规范

### 4.1 顶栏（首页）

```
[Logo 24px]                    [Deposit] [Withdraw]
                                 ↑ outline 按钮，高 36px
```

- Logo：SVG，单色或双色，高度 24–28px。  
- 充提：Outline + `brand.primary` 描边；提现可用 ghost。

### 4.2 余额区

- PHP：`text.primary` 28px bold + `₱` 前缀常字重。  
- USDT：一行 `text.secondary` 14px，右侧 chevron 进钱包。  
- 可选：微弱 `gradient.hero` 底条 4px 高。

### 4.3 快捷导航 Chip

- 高度 32px，圆角 full，背景 `bg.elevated`，图标+文字。  
- 活动/邀请可用 `brand.secondary` 描边或小红点。

### 4.4 Banner

- 比例 **16:9**，圆角 `radius.md`。  
- 指示点：宽 6px，当前 `brand.primary`。  
- 自动轮播 5s；手滑暂停。

### 4.5 分类 Tab

- 未选：`text.secondary`；选中：底边 2px `brand.primary` + `text.primary` bold。  
- Sticky 时背景 `bg.base` 95% 模糊（`backdrop-blur`）。

### 4.6 游戏卡片

| 元素 | 规范 |
|------|------|
| 比例 | 1:1 封面 |
| 标签 | 左上：`HOT` 金底；`DEMO` 蓝灰；`维护` 红底灰字 |
| 名称 | 封面下 2 行，13px |
| 按下 | scale 0.98 + 阴影减弱 |

### 4.7 主按钮（Primary）

- 高 48px，圆角 `radius.md`，`gradient.cta` 或纯色 `brand.primary`。  
- 禁用：opacity 0.4。  
- Loading：左侧 spinner，禁止双点。

### 4.8 红包 Bottom Sheet

- 顶图：插画风礼盒/金币（见插图规范）。  
- 金额：`brand.secondary` 36px bold。  
- 主按钮：`gradient.gold` + 轻微 glow。

### 4.9 流水进度条（提现）

- 轨道 `bg.elevated` 高 8px；填充 `brand.primary`。  
- 文案：`₱12,000 / ₱30,000 turnover`（示例）。

### 4.10 弹窗（游戏锁）

- 图标：手机 ×2 线稿。  
- 主按钮关闭；无次要破坏操作。

---

## 五、插图与营销素材

### 5.1 风格

| 类型 | 风格 |
|------|------|
| 空态 | 扁平矢量 + 少量金绿点缀，人物可选菲律宾肤色 |
| 红包/试玩官 | 偏 **3D 轻质感** 或 **2.5D 金币**，与界面扁平卡片对比突出 |
| 错误/维护 | 线性插画，低饱和度 |

### 5.2 尺寸导出（@2x / @3x）

| 资源 | 尺寸建议 |
|------|----------|
| App Logo | SVG + PNG 512 |
| 游戏默认图 | 400×400 |
| Banner | 1200×675 |
| 活动头图 | 1080×600 |
| 红包弹层头图 | 750×400 |
| 空态 | 240×240 |

### 5.3 品牌吉祥物（可选 P1）

- 概念：**热带鹦鹉 / 幸运骰子** 拟人化，用于试玩官活动。  
- 不强制 MVP；若做需全套表情 3–5 个。

---

## 六、动效规范（Motion）

| 场景 | 时长 | 曲线 |
|------|------|------|
| Tab 切换 | 200ms | ease-out |
| 页面进入 | 250ms | slide from right（二级页） |
| Bottom Sheet | 300ms | spring（轻微） |
| 红包打开 | 400ms | scale + fade |
| 骨架屏 shimmer | 1.2s loop | 低对比 |

**减少动效**：尊重 `prefers-reduced-motion`。

---

## 七、Telegram 主题适配

```javascript
// 伪代码：读取 themeParams 映射到 CSS 变量
const tp = Telegram.WebApp.themeParams
// bg_color → --tg-bg
// text_color → --tg-text
// button_color → 可与 brand.primary 对齐或保持品牌色
```

| 模式 | 策略 |
|------|------|
| TG Dark | 默认 Midnight Emerald，header 与 `bg_color` 对齐 |
| TG Light | 提升 `bg.surface` 亮度，文字改深，**保持 CTA 绿色** |

`setHeaderColor` / `setBackgroundColor` 与 `bg.base` 一致，避免顶栏色差。

---

## 八、Tailwind 映射示例

```javascript
// tailwind.config.js 片段（实施时写入 web-tma）
theme: {
  extend: {
    colors: {
      base: { DEFAULT: '#0B0F1A', surface: '#121826', elevated: '#1A2235' },
      brand: { primary: '#10B981', secondary: '#F59E0B' },
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      display: ['DM Sans', 'Inter', 'sans-serif'],
    },
    borderRadius: { card: '12px' },
    boxShadow: { card: '0 4px 24px rgba(0,0,0,0.25)' },
  },
}
```

---

## 九、交付物清单（设计 → 研发）

| 交付物 | 格式 | 负责人建议 |
|--------|------|------------|
| 设计令牌文档 | 本文 + Figma Variables | UI 设计 |
| 高保真稿（核心 8 屏） | Figma | UI 设计 |
| 图标集 | SVG Sprite | UI 设计 |
| 支付渠道 Logo | 官方包 | 运营/设计 |
| Banner/活动模板 | Figma + 导出规范 | 运营 |
| 切图 @2x/@3x | PNG/WebP | 设计 |
| 原型（可点） | Figma Prototype | 产品+设计 |

**MVP 高保真最低 8 屏**：首页、游戏 Loading、钱包、充值、提现、试玩官、邀请、KYC。

---

## 十、我能为你完成的 UI 设计范围（说明）

| 能力 | 说明 |
|------|------|
| ✅ **产品与交互方案** | 本文 + CLIENT 文档：流程、状态、组件、文案 |
| ✅ **设计系统/令牌** | 颜色、字体、组件规范、Tailwind 映射 |
| ✅ **线框与结构** | ASCII/文档级线框（已含） |
| ✅ **概念视觉稿** | 可用 AI 生成 1～3 张关键屏 **风格稿**（非切图） |
| ✅ **Canvas 交互原型** | 可在 Cursor 内做简易可点原型（React） |
| ⚠️ **Figma 高保真全量** | 需设计师在 Figma 按本指南落地；我可通过 Figma MCP **辅助**写入（若你连接 Figma） |
| ❌ **生产级切图/标注全包** | 建议 UI 设计师按第九章交付 |

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-23 | Midnight Emerald 主方案 + Tokens |
