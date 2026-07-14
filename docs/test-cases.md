# BETOGO 全站功能测试用例

> 基于 2026-07-06 代码现状整理。测试环境：`https://www.188facai.com`（47.84.34.139）。
> API 前缀 `/api/v1`；后台账号 admin / aa888888（super_admin）。
> 优先级：P0=资金/安全核心路径，P1=主流程，P2=次要功能/边界。
>
> **第一部分（一~十三章）** 为 2026-07-06 基线用例。
> **第二部分（十四章起）** 为 2026-07-06 之后新增/变更业务的补充用例，每条带「测试执行」标注。

### 测试执行标注说明（第二部分）

| 标记 | 含义 | Claude 能做的验证手段 |
|---|---|---|
| 🤖 | **Claude 可独立完成** | curl 打 `/api/v1` 接口、SSH 进 47.84.34.139 查 MySQL、in-app 浏览器访问站点检查渲染/console/network、后台 API 改配置后验证前台响应、防重/幂等重放、计算口径查库比对、cron 结算后查 pending 表 |
| 🤝 | **需人工配合触发，Claude 验数据** | 核心逻辑/接口/落库我能验，但触发链路需人工完成（真实充值到账、真机下注产生注单、TG 内打开、收到短信后回填），之后我核对数据库与接口返回是否正确 |
| 👤 | **必须人工** | 真机行为（全屏/横屏/PWA 安装/窄屏适配）、真实支付出款、短信 OTP、OAuth 授权、Turnstile/CAPTCHA、KYC 证件/人脸、视觉设计还原度、动画动效主观判断 |

---

## 一、账号与登录（web-tma）

### 1.1 注册 / 登录

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| AUTH-001 | 手机号+密码注册 | 未注册的 PH 手机号 | 登录框→手机号 tab→注册→输入手机号+密码提交 | 注册成功并自动登录；手机号归一化为 63 开头 | P0 |
| AUTH-002 | 手机号重复注册 | AUTH-001 已注册 | 用同一手机号再次注册 | 提示已被占用（409），不创建新号 | P0 |
| AUTH-003 | 账号+密码注册/登录 | — | 账号 tab 注册后登出，再用账号+密码登录 | 两步均成功，回到同一账号 | P0 |
| AUTH-004 | 密码错误登录 | 已有账号 | 连续输错密码 | 返回 401；连续 5 次/10 分钟内触发限流 | P1 |
| AUTH-005 | 注册参数校验 | — | 手机号格式错误 / 密码过短提交 | 返回 400 并有可读提示，不创建账号 | P1 |
| AUTH-006 | Google 登录 | 浏览器环境 | 点击 Continue with Google→完成 OAuth 回调 | 回调页 `/auth/google/callback` 处理后登录成功 | P0 |
| AUTH-007 | Telegram OIDC 登录（浏览器） | 浏览器环境 | 点击 Continue with Telegram→TG 授权→回调 `/auth/telegram/callback` | 登录成功；同一 TG 授权再登录回到同一账号（按 telegram_oidc_sub 映射） | P0 |
| AUTH-008 | Telegram Mini App 内自动登录 | 在 TG 内打开 Mini App | 打开 @BetoGoBot Mini App | initData 验签通过自动登录，无需手动操作 | P0 |
| AUTH-009 | 代理 bot 入口登录归因 | 已配置代理 bot | 从代理 bot 打开 Mini App 注册新号 | 多 token 验签命中代理 bot；新用户归因到对应代理（bg_user_agent） | P1 |
| AUTH-010 | 代理域名归因 | 后台已配置代理域名 | 通过该域名首次注册 | 新用户归因到对应代理；老用户不重复归因 | P1 |
| AUTH-011 | 登出 | 已登录 | 菜单→登出 | 会话失效；TG 内不再自动登录（LOGOUT_FLAG 生效） | P1 |
| AUTH-012 | 会话恢复 | 已登录后关闭再打开 | 重新打开站点 | restoreSession 通过 /user/me 恢复登录态 | P1 |
| AUTH-013 | token 过期刷新 | access token 过期 | 继续操作任意需登录接口 | /auth/refresh 静默续期，用户无感知 | P1 |

### 1.2 忘记密码

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| AUTH-020 | 忘记密码发送 OTP | 已注册手机号 | 忘记密码→输入手机号→发送验证码 | 真机收到短信；60 秒内重发被拒 | P1 |
| AUTH-021 | OTP 重置密码 | AUTH-020 | 输入正确验证码+新密码 | 重置成功，旧密码失效、新密码可登录 | P0 |
| AUTH-022 | OTP 错误/过期 | AUTH-020 | 输错验证码 5 次 / 超过 300 秒后提交 | 拒绝重置并锁定/失效，提示重新获取 | P1 |
| AUTH-023 | 未注册手机号请求重置 | — | 用未注册手机号走忘记密码 | 不能重置任何账号；提示合理且不泄露注册状态 | P2 |

### 1.3 记住上次登录方式

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| AUTH-030 | OAuth 快捷续登卡片 | 勾选 Remember me 用 Google 登录过并登出 | 再次打开登录框 | 显示"欢迎回来"卡片（头像+昵称）+ 一键 Continue with Google | P1 |
| AUTH-031 | 手机号/账号预填 | 勾选 Remember me 用手机号登录过 | 再次打开登录框 | 自动切到手机号 tab、号码预填、密码框聚焦；密码不被记住 | P1 |
| AUTH-032 | 使用其他账号 | AUTH-030 | 点"使用其他账号" | 清除本地记忆，回到完整登录表单 | P2 |
| AUTH-033 | 未勾选 Remember me | 登录时不勾选 | 登出后再开登录框 | 不出现快捷续登卡片、不预填 | P2 |

### 1.4 账号绑定（菜单→账号与登录方式）

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| AUTH-040 | 绑定手机号 | 账号未绑手机 | BindModal 绑定新手机号 | 绑定成功；可用该手机号+密码登录同一账号 | P1 |
| AUTH-041 | 绑定冲突 | 手机号已属他人（含他人 KYC 手机） | 绑定该手机号 | 409 提示已占用；手机号全局互斥（phone_account ∪ kyc.phone） | P0 |
| AUTH-042 | 绑定 Google/Telegram | 未绑对应方式 | 走 OAuth 绑定流程（bind intent） | 绑定成功；该 OAuth 再登录直达本账号；已被他号占用时 409 | P1 |
| AUTH-043 | 跨端账号统一 | TMA 内账号已绑密码 | 浏览器用同一密码登录 | 登录到同一账号，余额/记录一致 | P1 |

### 1.5 多语言

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| I18N-001 | 切换语言 | 已登录 | 切换 en / zh-CN / vi / id 各一遍 | 全站主要页面文案切换；PATCH /user/language 持久化，重进保持 | P1 |
| I18N-002 | 缺失键回退 | 切到 vi/id | 浏览新功能页（Games、客服等） | 未翻译键回退英文，不出现键名裸串 | P2 |

---

## 二、首页（HomeContent）

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| HOME-001 | 首页板块加载 | 已登录（PHP） | 打开 /home | popular/高返/newGames/slots/casino/perya/fishing/lottery/百家乐/高RTP/sports 等板块按序渲染，卡片图正常 | P0 |
| HOME-002 | popular 组成规则 | — | 检查 popular 前 9 | 全部来自 featured 核心池；含 1 个真人席位（第 3 位附近）；单厂商 ≤3；无体育合成条目 | P1 |
| HOME-003 | 分类 chip 导航 | — | 点 Slots/Casino/Perya 等 chip | 跳转 /games?cat=对应分类，Games 页 tab 高亮正确 | P1 |
| HOME-004 | View All 联动 | — | 各板块点 View All；厂商专区点 View All | 跳 /games?cat=xxx（厂商专区带 provider=xxx 且 chip 高亮滚入视野），列表数与分类一致 | P1 |
| HOME-005 | 后台 pin/exclude 生效 | 后台板块配置已 pin 一款到 slots 首位 | 刷新首页 | PHP 下 slots[0]=被 pin 游戏；不支持该币种时安全跳过 | P1 |
| HOME-006 | 币种切换 | 账号有 USDT | 切 USDT | 各板块按 USDT 选品池重渲染，不出现整屏 unavailable | P1 |
| HOME-007 | 游戏卡角标 | — | 观察卡片 | 万倍(琥珀)>NEW(蓝)>高返(红) 单角标优先级正确 | P2 |
| HOME-008 | 动图封面懒加载 | 真机 | 滚动到带动图的头牌游戏 | 进入视口后静态首帧切动图 webp 播放；首屏不因动图变慢 | P2 |
| HOME-009 | 最近玩过 | 启动过游戏 | 回首页看 recently played | 展示最近启动的游戏（bg_game_launch），点击可再进 | P2 |
| HOME-010 | 首页装修内容 | 后台配置了 banner/公告 | 打开首页 | /home/content 下发的轮播图、公告、社交位正确展示，图片 200 | P1 |
| HOME-011 | 底部合规信息区 | — | 滚到首页底部 | PAGCOR、21+、负责任博彩等合规元素与品牌信息按新版设计展示 | P2 |
| HOME-012 | 搜索 | — | 搜索框逐字输入 "color" | 仅按防抖后的完整词发一次请求；结果与关键词一致；清空恢复 | P1 |

### 首页弹窗

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| HOME-020 | 新人礼包弹窗 | 新注册用户，活动开启 | 首次进首页 | 长滚动弹窗展示（总额=真实配置加总、有零有整）；含注册/下载/首充任务 | P1 |
| HOME-021 | 弹窗收纳浮标 | HOME-020 | 关闭弹窗 | 收纳为右下角悬浮挂件；点击可重开；全部领完后永久不弹 | P1 |
| HOME-022 | 弹窗频控 | 看过弹窗 | 同会话内切页返回首页 | 不重复弹（localStorage 标记生效） | P2 |
| HOME-023 | 后台弹窗管理 | 后台关闭某弹窗 | 前台刷新 | 被关闭的弹窗不再出现；顺序/人群配置生效 | P1 |
| HOME-024 | App 下载浮窗 | 浏览器（非 TG、非 standalone）+活动开 | 打开首页 | 浮窗第三项显示 App 下载动效；TG 内 / PWA 内不显示 | P2 |

---

## 三、Games 页与游戏启动

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| GAME-001 | 分类 tab 切换 | — | 依次点 All/Perya/Slots/Casino/Fishing/Lottery/Poker/Sports/Other | 每类列表刷新且总数与该 siteCategory 一致；URL cat= 同步、navigate replace 不压历史 | P0 |
| GAME-002 | 厂商二级筛选 | 选中 Slots | 点某厂商 chip；点 ⌄ 展开多行 | 列表只剩该厂商；URL provider= 同步；All 分类默认隐藏厂商条 | P1 |
| GAME-003 | 深链直达 | — | 直接打开 /games?cat=slot&provider=JiLiGaming | 分类 tab+厂商 chip 均选中且滚入视野，列表正确 | P1 |
| GAME-004 | 无限滚动 | 真机 | 列表滚到底 | 自动加载下一页，无重复卡片；弱网下旧响应不覆盖新页（请求序号） | P1 |
| GAME-005 | 后台置顶排序生效 | 后台对 perya 置顶 2 款 | 打开 /games?cat=perya | 前 2 位=置顶款，第 3 位起回落默认权重；第 2 页不再出现置顶款 | P1 |
| GAME-006 | Perya 横幅 | — | Perya 分类顶部点 Carnival 横幅 | 打开 /perya 策展页（BingoPage） | P2 |
| GAME-007 | 启动真钱游戏 | 已登录有余额 | 点任意游戏卡 | /slots/init 拉起游戏 URL，加载成功可下注 | P0 |
| GAME-008 | 未登录点游戏 | 未登录 | 点游戏卡 | 弹登录框而非报错 | P1 |
| GAME-009 | H5 全屏 | 安卓 Chrome | 进游戏 | 自动 requestFullscreen 真全屏；退出游戏还原；iOS 静默降级为铺满视口 | P2 |
| GAME-010 | 非游戏页禁横屏 | 手机 | 在首页/钱包页横置手机 | 出现"请竖屏"遮罩；游戏内横屏不拦截 | P2 |
| GAME-011 | 投注记录 | 有真实注单 | 打开投注记录页 | 注单列表（游戏名/金额/派彩/时间）与 568win 报表一致；分页正常 | P0 |
| GAME-012 | 无效游戏 uuid | — | /slots/init 传非 568win uuid | 返回 400，不崩溃 | P2 |

---

## 四、钱包与充值

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| DEP-001 | 渠道列表 | 已登录 | 打开充值 | /payment/channels 返回后台启用渠道（gcash/maya 等）；被禁渠道不显示 | P0 |
| DEP-002 | YF Pay GCash 充值全流程 | 渠道启用 | 创建订单→收银台支付→回跳 | 订单 paid、回调验签通过、钱包入账金额=订单金额（分→元换算正确）、账变多一条 deposit | P0 |
| DEP-003 | BeePay 渠道充值 | BeePay 凭证已配 | 走 BeePay 渠道充值 | 下单/回调（MD5 小写签名）/入账全通；回调返回明文 success | P0 |
| DEP-004 | 充值回调防重 | DEP-002 完成 | 重放同一回调 | 不重复入账（幂等），余额不变 | P0 |
| DEP-005 | 回调签名伪造 | — | 篡改金额后回调 | 验签失败拒绝，订单不变 | P0 |
| DEP-006 | 订单查询 | 有 pending 单 | 收银台不支付，前台点查询 | /deposit/query 返回真实状态；超时单不误标已付 | P1 |
| DEP-007 | 充值记录 | 有历史订单 | 打开充值记录 | 订单号/金额/渠道/状态/时间正确，分页正常 | P1 |
| DEP-008 | Telegram Stars 充值 | TG 内 | Stars 支付流程 | 验签通过入账；Stars 不支持提现的提示正确 | P1 |
| DEP-009 | Matrix 加密充值 | — | 获取 /deposit/matrix/address 转账 | 地址正确展示；链上到账后入账（按汇率折算） | P1 |
| DEP-010 | 渠道充值奖励（Maya） | 后台开启 Maya 渠道奖励 | 用 Maya 充值满足条件 | 奖励自动发放且只发一次；GCash 充值不发；真实渠道首充奖励正常发放（回归 37ba2f7） | P0 |
| DEP-011 | 金额边界 | — | 低于渠道最小值/超最大值/非数字金额 | 前端拦截或后端 400，不建单 | P1 |

---

## 五、提现

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| WD-001 | 未 KYC 提现被拒 | 未实名账号有余额 | 依次尝试 yfpay / tg_wallet / matrix 提现 | 三通道均 403"请先完成实名认证"（POST 层硬闸门，非仅前端） | P0 |
| WD-002 | 流水未达标提现 | 已 KYC 但有未完成流水要求 | 发起提现 | 被流水闸门拦截，提示剩余流水；/wallet/turnover 进度一致 | P0 |
| WD-003 | 正常提现全流程 | KYC 通过+流水达标 | 发起 GCash 提现→自动审核全过 | 自动批准出款，yfpay 代付回调后状态 completed，余额/账变正确 | P0 |
| WD-004 | 命中规则转人工 | 构造大额单（超 large_amount 阈值） | 发起提现 | verdict=manual 进人工队列，用户侧显示处理中；不自动出款 | P0 |
| WD-005 | 提现余额不足 | 余额 100 | 提现 200 | 拒绝，余额不变 | P0 |
| WD-006 | 提现并发防重 | 余额恰好够一笔 | 快速连续提交两笔 | 只成功一笔，无负余额 | P0 |
| WD-007 | 提现记录与状态流转 | 有各状态订单 | 查看提现记录 | pending/processing/completed/rejected 展示正确；拒绝单余额已退回 | P1 |
| WD-008 | Matrix 链上提现 | KYC 通过 | 发起 crypto 提现 | 审核通过后调 matrix API 出款，txid 可查 | P1 |
| WD-009 | 审核引擎异常兜底 | 模拟规则执行报错 | 发起提现 | 引擎 try/catch 兜底转人工（manual），绝不自动放行 | P1 |

### 自动审核规则（后台配合验证，scope=user）

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| WD-020 | 大额取款/大额盈利/高倍盈利规则 | 分别构造超阈值场景，命中对应 rule_code 转人工，快照记录命中原因 | P0 |
| WD-021 | 同 IP/同设备关联规则 | 两账号同 IP 提现命中 same_ip_device | P1 |
| WD-022 | 篡改注单规则 | 凭空派彩 round / 对账差异日命中 tampered_bet | P1 |
| WD-023 | 上游对账规则 upstream_reconcile | 本地注单在 568win 报表缺失时命中；同步覆盖起点之前的历史单不误报 | P0 |
| WD-024 | 红利滥用/撤单模式规则 | bonus_bet_abuse、cancel_pattern 按配置阈值命中 | P1 |
| WD-025 | 黑名单规则 | 用户上线在风控名单中→命中 upline_blacklist 转人工 | P1 |
| WD-026 | 规则开关生效 | 后台 enabled=0 某规则后同场景不再命中 | P1 |

---

## 六、KYC 实名认证

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| KYC-001 | 手机 OTP 验证 | 已登录未实名 | KYC Setting→发送验证码→输入 | 真机收码；验证通过进入证件步骤；60s 重发限制、5 次错误锁定 | P0 |
| KYC-002 | 证件识别通过 | KYC-001 完成 | 上传清晰真实证件照 | Gemini 判定 approved（置信度≥0.85），进入人脸步骤 | P0 |
| KYC-003 | 人脸识别通过 | KYC-002 | 全屏人脸步骤拍照提交 | 通过后整体 approved；提现闸门放行 | P0 |
| KYC-004 | 未满 21 岁拒绝 | — | 上传出生日期<21 岁的证件 | 拒绝并返回 underage 原因，各语言文案正确 | P0 |
| KYC-005 | 证件/手机防薅 | 手机号或证件号已过他人 KYC | 用同一手机/证件再认证 | 拒绝，一手机/一证件只能过一个账号 | P0 |
| KYC-006 | 被拒后重新提交 | 后台已驳回 | 客户端查看状态并重新提交 | 状态显示 rejected+原因（不显示 approved）；重提后后台红点重新亮起 | P1 |
| KYC-007 | 模糊/伪造证件 | — | 上传截图翻拍/模糊件 | 判 rejected 或转人工，不误放行 | P1 |
| KYC-008 | KYC Setting 独立页 | — | 菜单→KYC Setting | /kyc-setting 全屏页流程与提现内弹窗一致，状态同步 | P2 |

---

## 七、活动与优惠（BonusesPage / promotions）

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| PROMO-001 | 活动列表 | 后台开启若干活动 | 打开 Bonuses 页 | 仅显示已开启活动；文案金额来自真实配置 | P1 |
| PROMO-002 | 试玩礼金领取 | 新号，trial 开启 | 领取试玩礼金 | 红包入账一次；再点 409/已领取；关闭活动后领取被拒 | P0 |
| PROMO-003 | 首充奖励 | 首充活动开启 | 新号首次充值 | 按分档比例入账（如 120%/上限 ₱1000）；二次充值不再发首充 | P0 |
| PROMO-004 | 首充神秘话术 | — | 未首充用户看弹窗/活动页 | 神秘首充话术展示正确，充值后揭示真实奖励 | P2 |
| PROMO-005 | App 下载礼金 | appdl 开启 | PWA(standalone) 内点 Claim | 入账+流水要求（X5/30天）创建；浏览器内显示 Install Now；重复领取 409；TG 内隐藏 | P1 |
| PROMO-006 | 推荐好友 | 已登录 | 获取推荐链接→新设备注册充值 | 邀请关系建立；推荐奖励按配置发放；推荐记录页可见 | P1 |
| PROMO-007 | 红包记录 | 有奖励入账 | 查看 red-packets 记录 | 各活动入账记录完整、金额正确 | P2 |
| PROMO-008 | 优惠流水要求 | 领取带倍率的奖励 | 领取后查提现资格 | 生成 promoRequirement，未打满流水前提现被拦 | P0 |
| PROMO-009 | 活动开关即时性 | 后台关闭活动 | 前台刷新并尝试领取 | 入口消失且接口拒绝（不能仅靠前端隐藏） | P1 |

### 转盘（RewardsSpinPage）

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| SPIN-001 | 转盘状态与次数 | 转盘开启 | 打开转盘页 | /spin/status 显示剩余次数/规则正确 | P1 |
| SPIN-002 | 抽奖 | 有次数 | 点抽奖 | 动画结果与 /spin/draw 返回一致；奖励入账；次数-1 | P0 |
| SPIN-003 | 无次数抽奖 | 次数为 0 | 点抽奖 | 拒绝并提示获取方式；连点不产生多次扣减 | P1 |
| SPIN-004 | 中奖记录 | 抽过奖 | 查看 records | 记录与实际入账一致 | P2 |

### 洗码返水（CashbackPage）

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| RB-001 | 等级与进度 | 有投注流水 | 打开洗码页 | 当前 LV、累计有效流水、升级进度条与 /rebate/progress 一致；LV 徽章同步显示在个人中心 | P1 |
| RB-002 | 全等级费率轮播 | — | 横滑费率卡片 | LV1-6×大类费率与后台矩阵一致；默认居中当前等级；LV6 特殊配色 | P2 |
| RB-003 | 每日结算生成待领取 | 前一日有有效投注 | 等 cron 结算后查看 | 可领取池金额=Σ(有效流水×当前等级费率)；只写 pending 不自动入账 | P0 |
| RB-004 | 领取返水 | 有 pending | 点领取 | pending→paid 入账，钱包刷新；重复点击不重复入账 | P0 |
| RB-005 | 升级生效 | 流水跨过阈值 | 次日结算 | 按新等级费率计算 | P1 |
| RB-006 | 精选游戏独立费率 | 后台配了 featured 覆盖 | 玩该游戏产生流水 | 按覆盖费率（如 elite 2%）计算而非大类费率 | P2 |

---

## 八、三级分销（TeamCenterPage）与代理

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| TEAM-001 | 开通分销 | 已登录 | 团队中心→开通 | /team/enable 成功，获得邀请链接 | P1 |
| TEAM-002 | 三级关系建立 | A 邀 B，B 邀 C，C 邀 D | 依次注册 | tree 正确：B/C/D 分别是 A 的 1/2/3 级 | P1 |
| TEAM-003 | 佣金计算 | 下线产生 GGR | 结算后查 commissions | level1/2/3 比例正确；GGR=bet−win−赠金口径 | P0 |
| TEAM-004 | 佣金提现（人工审核） | 佣金钱包有余额 | 发起 /team/withdraw | 进 team 审核队列；通过后入玩家钱包；拒绝退回 | P0 |
| TEAM-005 | 佣金提现风控规则 | — | 构造佣金激增/新下线占比高/佣金>下线存款×0.5/同 IP 下线 | commission_surge / fresh_downline_commission / commission_deposit_ratio / downline_ip_overlap 各自命中转人工 | P1 |
| TEAM-006 | 佣金重复结算防护 | 已结算月份 | 后台再次 settle 同月 | 已 paid 不覆盖、不重复入账 | P0 |
| AGENT-001 | 代理中心可见性 | 普通用户 vs 后台设为代理的用户 | 各自打开菜单 | 普通用户无代理入口；代理可见 /agent 只读报表（GGR/分成/名下用户数） | P1 |
| AGENT-002 | 代理报表口径 | 名下用户有投注 | 对比 /agent/center 与后台月结 | GGR、负 GGR 结转、分成金额一致 | P1 |

---

## 九、AI 客服（CustomerServicePage）

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| CS-001 | 欢迎语+快捷选项 | 新会话 | 打开客服页 | 欢迎气泡（后台可配文案）+8 个快捷选项两列展示 | P1 |
| CS-002 | 充值未到账直查 | 登录用户有已到账充值单 | 点"充值未到账" | 不经 LLM 直查库渲染订单卡片（金额+状态徽+订单号+渠道+时间）；已到账单绝不说"没到账"、不转人工 | P0 |
| CS-003 | 提现进度直查 | 有提现单 | 点"提现进度" | 订单卡片状态与真实一致（success/pending/failed 归一口径） | P0 |
| CS-004 | 自由文本秒回 | — | 打字问"我的充值到账了吗" | 命中前置正则直查库文本秒回；超 30 分钟 pending 单回落 AI 走转人工 | P1 |
| CS-005 | AI 流式回复 | — | 问开放性问题（如怎么玩转盘） | SSE 流式逐块输出（非最后一次性吐出）；回答不编造链接/数字；跟随用户语言 | P1 |
| CS-006 | 常见问题菜单按钮 | 对话进行中 | 点输入框旁菜单按钮 | 随时可再弹 8 个快捷选项 | P2 |
| CS-007 | 转人工（在线） | 后台值班开+管理员 SSE 在线 | 说"人工客服" | 会话转 human_taken，AI 停答；后台收到会话，管理员回复用户可见 | P0 |
| CS-008 | 转人工（离线） | 值班关或无管理员在线 | 触发转人工 | 生成离线工单（escalated+工单号），AI 如实告知并继续应答；管理员回复触发 TG 推送 | P1 |
| CS-009 | 游客客服 | 未登录 | 直接发消息 | AI 正常回复（guest id 兼容）；点订单类选项引导登录 | P1 |
| CS-010 | 会话历史 | 有历史对话 | 重进客服页 | /cs/history 恢复上下文 | P2 |
| CS-011 | 敏感词硬转人工 | — | 消息含 complaint/refund/scam/estafa | 强制转人工不被 AI 拦截 | P1 |

---

## 十、下载 / PWA / 多端

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| PWA-001 | 顶部下载条 | 浏览器打开（非 TG/PWA） | 打开站点 | 顶部下载条显示（活动开启时换活动文案）；点 X 当次会话隐藏、下次会话再现 | P2 |
| PWA-002 | 下载页 | — | /download | 仿商店页渲染（评分/截图/Get 按钮假进度）；进度完成后 iOS→安装引导弹窗、Android→beforeinstallprompt 或安卓引导 | P1 |
| PWA-003 | 安卓 Chrome 安装 | 安卓真机 | 触发安装 | 原生 A2HS 弹窗→桌面图标→standalone 打开正常登录游戏 | P1 |
| PWA-004 | iPhone Safari 引导 | iOS 真机 | 触发安装 | 三步图文引导正确；手动添加后 standalone 正常；**无白屏**（gzip 回归 [[reference_ios_whitescreen_gzip]]） | P0 |
| PWA-005 | iOS Chrome install 按钮 | iOS Chrome | 点顶部 install | 有合理响应（引导或提示），不允许点击无反应（已知遗留 bug 回归） | P1 |
| PWA-006 | TG 内隐藏安装引导 | Telegram 内 | 浏览各页 | 下载条/安装引导/appdl 浮窗均不显示 | P2 |
| PWA-007 | SW 不缓存旧包 | 发版后 | 刷新页面 | 直接拿到新 bundle，无新旧混用白屏 | P1 |
| COMPAT-001 | 四端冒烟 | — | H5 手机站 / PWA / 安卓 App(如有) / TG Mini App 各跑登录→充值→游戏→提现申请 | 主流程全通 | P0 |

---

## 十一、账变与记录页

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| LEDGER-001 | 账变完整性 | 完成充值/投注/派彩/红包/返水/提现各一笔 | 打开账变记录 | 每笔资金变动都有对应 ledger 条目，类型/金额/余额快照正确 | P0 |
| LEDGER-002 | 余额一致性 | LEDGER-001 | 核对钱包余额 | 余额 = Σ账变；/wallet/balances 与 /wallet/summary 一致 | P0 |
| BET-001 | 注单与流水口径 | 玩不同大类游戏 | 对比投注记录与流水进度 | effective_amount 按大类系数计算（568win 用 effective sort_category 而非恒 1.0） | P1 |

---

## 十二、web-admin 后台

### 12.1 登录与权限

| 编号 | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| ADM-001 | 管理员登录 | — | admin/aa888888 登录 | 成功进入后台 | P0 |
| ADM-002 | TOTP 两步验证 | 账号已启用 TOTP | 登录→输 TOTP | 密码对但 TOTP 错→拒绝；对→通过；禁用后不再要求 | P0 |
| ADM-003 | 角色越权 | finance/ops/support 账号 | 访问 super_admin 专属（op-password、管理员管理） | 403；菜单不显示对应入口 | P0 |
| ADM-004 | 未登录访问后台 API | — | 无 token 直接请求 /admin/* | 401 | P0 |
| ADM-005 | 修改密码 | 已登录 | 改密→旧密码登录 | 旧密码失效、新密码可登录 | P1 |

### 12.2 用户中心

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-010 | 用户列表/搜索/详情 | 列表分页搜索正常；详情余额/等级/累计流水/绑定方式正确 | P1 |
| ADM-011 | 余额调整需操作密码 | 不传/错 opPassword→拒绝；正确→入账并留审计 | P0 |
| ADM-012 | 封禁用户 | status 禁用后该用户登录/下注被拒 | P0 |
| ADM-013 | 流水要求管理 | 查看/调整用户 turnover 要求，前台提现闸门同步变化 | P1 |
| ADM-014 | KYC 审核 | 通过/驳回（驳回后前台不显示 approved、docVerified/faceVerified 清零）；撤销认证确认弹窗可弹（React19 补丁回归）；拒绝红点计数+忽略按钮 | P0 |
| ADM-015 | 风控名单 | 增删黑名单，提现规则 upline_blacklist 联动生效 | P1 |

### 12.3 财务中心

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-020 | 存款/取款记录 | 与前台订单一致；筛选/导出正常；提现完成时间取 handled_at 非空 | P1 |
| ADM-021 | 支付渠道 CRUD | 新增/编辑/禁用渠道即时反映到前台渠道列表；crypto 下拉联动 | P1 |
| ADM-022 | 渠道规则 | 金额上下限等规则生效 | P2 |
| ADM-023 | 服务商余额与记账 | 手动刷新拉真实余额（yfpay/beepay）；代收=充值 paid、代付=提现 completed 聚合正确 | P1 |
| ADM-024 | 汇率管理 | 刷新/手动设置/删除手动汇率，crypto 折算随之变化 | P1 |
| ADM-025 | 账变查询 | 按用户/类型/时间筛选正确 | P1 |

### 12.4 取款审核模块

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-030 | 待审队列（玩家+佣金） | manual-queue UNION 两类 kind 正确；user 进详情、team 队列内出款 | P0 |
| ADM-031 | 提案详情 | 审核快照、逐规则结果、关联账号、用户画像完整 | P1 |
| ADM-032 | 人工批准/拒绝 | 批准走真实出款（matrix 调 API）；拒绝退回余额；handled_by/at 留痕 | P0 |
| ADM-033 | 重跑审核 | rerun 轮次+1，用最新配置重新裁决 | P2 |
| ADM-034 | 规则配置双 scope | 玩家提款/佣金提现两 Tab 阈值互不影响；保存后立即生效并审计 | P1 |

### 12.5 游戏中心

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-040 | 游戏列表与开关 | 单游戏/整厂商开关后前台列表同步（缓存 60s 内重建） | P1 |
| ADM-041 | 游戏编辑 | 改名/换分类/换封面生效；只 PATCH 部分字段不清空其他覆盖（回归 499109a） | P1 |
| ADM-042 | 多源换图 | cover-candidates 弹窗各源图可选；选 568win 原图=清覆盖回退 | P2 |
| ADM-043 | 首页板块配置 | pin/exclude/币种隔离生效（联动 HOME-005） | P1 |
| ADM-044 | 分类置顶排序 | 置顶/上下移/移除，保存清缓存即时生效（联动 GAME-005） | P1 |
| ADM-045 | 568win 同步 | 手动 sync 拉新游戏入库，不重复 | P2 |
| ADM-046 | 投注订单查询 | 按用户/时间/游戏筛选与上游报表一致 | P1 |

### 12.6 营销运营

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-050 | 活动配置保存 | trial/首充分档/推荐/appdl/渠道充值奖励各卡片保存后前台配置接口即时更新；非法值被校验 | P1 |
| ADM-051 | 参与记录 | 各活动 claims 筛选正确（appdl 按 description 区分） | P2 |
| ADM-052 | 转盘配置 | 奖池/概率/次数规则改动后前台生效；概率总和校验 | P1 |
| ADM-053 | 洗码配置 | LV1-6×9 大类矩阵、阈值、精选游戏、手动结算全链路 | P1 |
| ADM-054 | 首页装修 | banner/公告/社交位上传与增删改，前台 /home/content 同步；弹窗管理 tab 开关/排序/人群生效 | P1 |

### 12.7 分销与代理

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-060 | 分销概览/代理树 | 数据与 TEAM-002/003 一致 | P1 |
| ADM-061 | 分销结算与提现审批 | settle 幂等；approve/reject 资金流正确 | P0 |
| ADM-062 | 费率方案 | 新建/设默认/指定用户方案，佣金按新费率算 | P1 |
| ADM-063 | 渠道代理管理 | 代理 CRUD、域名/机器人池分配（token 校验 getMe、不回显）、手动绑定/解绑用户 | P1 |
| ADM-064 | 代理月结与打款 | settle 默认上月、负 GGR 结转、标记线下打款后不可重复结算覆盖 | P0 |

### 12.8 客服与系统

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| ADM-070 | 值班开关与接管 | 开关+SSE 在线共同决定转人工分流；接管后 AI 停答；回复触达用户；resolve 关单 | P1 |
| ADM-071 | FAQ/欢迎语管理 | 增删改 FAQ（默认 lang=en）、欢迎语编辑即时生效 | P2 |
| ADM-072 | 离线工单 | escalated 筛选、原因标签、徽章计数含 escalated | P1 |
| ADM-073 | 操作密码管理 | super_admin 设置/修改 op-password，余额调整联动验证 | P0 |
| ADM-074 | 短信设置与日志 | 短信商配置、发送日志可查 | P2 |
| ADM-075 | 系统参数/KYC 设置/568win key 轮换 | 保存生效并审计 | P1 |
| ADM-076 | 审计日志 | 敏感操作（余额调整/规则改动/游戏排序/活动开关）均有审计记录，含操作人 | P0 |
| ADM-077 | 实时徽章 SSE | 新提现/新 KYC 拒绝/新客服会话红点实时推送；忽略后消失 | P2 |

---

## 十三、非功能与安全

| 编号 | 用例名称 | 验证点 | 优先级 |
|---|---|---|---|
| SEC-001 | 水平越权 | 用户 A 的 token 查用户 B 的订单/注单/账变→403 或空 | P0 |
| SEC-002 | SQL 注入 | 搜索框、订单号、userId 参数注入 payload 全部无效（参数化） | P0 |
| SEC-003 | XSS | 用户名/客服消息含 `<script>` 不执行（客服纯文本渲染） | P1 |
| SEC-004 | webhook 来源伪造 | 568win seamless / yfpay / beepay / TG Stars 回调伪造签名全部被拒 | P0 |
| SEC-005 | 敏感信息不回显 | bot_token、密码 hash、API key 不出现在任何接口响应 | P1 |
| PERF-001 | 首页加载 | 常规 4G 下首屏可交互 <5s；封面图懒加载不阻塞 | P1 |
| PERF-002 | 弱网竞态 | 弱网快速切分类/搜索，旧响应不覆盖新结果（请求序号机制） | P1 |
| STAB-001 | 部署后冒烟 | fast 部署后 /health ok、登录/首页/充值渠道三接口 200；DNS 坑（ENOTFOUND tma-mysql）出现时按 [[reference_deploy_dns]] 再 restart 恢复 | P0 |
| STAB-002 | 迁移安全 | 新迁移只执行一次（schema_migrations），重复部署不清数据 | P0 |

---
---

# 第二部分：2026-07-06 后新增/变更业务补充用例

> 每条标「测试执行」列：🤖 Claude 可独立完成 / 🤝 需人工配合触发 Claude 验数据 / 👤 必须人工。

## 十四、任务中心（TaskCenterPage + 首页任务浮球）

> 统一任务引擎，四组任务：newbie / daily / achievement / social；奖励类型 cash（走 creditWallet，带 turnoverX 时叠加打码）/ spin（写 bg_spin_chance）/ growth（累加 bg_user_vip_state.task_growth 喂 VIP 等级）。接口 `GET /tasks?currency=`、`POST /tasks/:id/claim`、`POST /tasks/social/:key/claim`；均前置风控 `riskAllowed('promo_claim')`。任务配置按币种存 `bg_admin_settings.task_config`，稳定币未配则 PHP÷58 派生。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| TASK-001 | 任务中心四区加载 | 登录后打开任务中心 | `GET /tasks` 返回 newbie/daily/achievement/social 四组卡片；进度、可领状态与后台配置一致 | P0 | 🤖 |
| TASK-002 | 每日存款三档 | 当日累计存款分别达 100/500/2000（默认阈值） | daily_deposit_t1/t2/t3 依次点亮可领；未达档位置灰 | P1 | 🤝 |
| TASK-003 | 每日投注笔数任务 | 当日有效投注（单注≥10）满 5 笔 | daily_bets 达成可领；不足笔数不可领 | P1 | 🤝 |
| TASK-004 | 每日指定分类局数 | 玩 slot 分类满配置局数 | daily_play 进度按分类局数累计并可领 | P2 | 🤝 |
| TASK-005 | 新手·完善资料 | 同时绑定 Google + Telegram | profile_complete 达成（需 2 个绑定齐全）；缺一不可领 | P1 | 👤 |
| TASK-006 | 新手·首次下注 | 首次真钱下注 | first_game 一次性达成可领 | P1 | 🤝 |
| TASK-007 | 邀请里程碑 | 名下有效邀请人数达阈值 | invite_milestone 达标可领；同 achievement 区签到里程碑卡展示 | P2 | 🤝 |
| TASK-008 | cash 任务领取入账+打码 | 领取带 turnoverX>0 的 cash 任务 | 走 creditWallet 入账一次；生成 promoRequirement 打码要求；重复领取被拒 | P0 | 🤖 |
| TASK-009 | spin 任务发转盘次数 | 领取 spin 奖励任务 | bg_spin_chance +N（复用 kind='checkin' 最低启用档），转盘页次数同步 | P1 | 🤖 |
| TASK-010 | growth 任务喂 VIP 成长 | 领取 growth 任务后查 VIP 进度 | bg_user_vip_state.task_growth 增加对应 amount（按币种独立）；VIP 等级判定累计流水含 task_growth | P1 | 🤖 |
| TASK-011 | 社群·Telegram 关注验证 | 已绑 TG，加入官方频道后领取 | `/tasks/social/:key/claim` 经 Bot getChatMember 校验 member/admin/creator 通过入账；未加入 403 not_member；未绑 TG 428 need_bind_telegram | P1 | 🤝 |
| TASK-012 | 社群·回填码/截图审核 | Facebook/Viber 任务提交码或截图 | code_redeem 码错 400；截图走 manual_review 入 bg_task_manual_review 待后台审核，不立即入账 | P2 | 🤝 |
| TASK-013 | 领奖后接力下一任务 | 完成并领取任务条中的任务 | 领奖后就地延续下一个任务上下文（不整条消失），进度回流刷新 | P2 | 🤖 |
| TASK-014 | 聚合卡跳转入口 | 查看 achievement/newbie 聚合卡（trial/appdl/firstdep/birthday/checkin） | display-only 卡点击跳对应原模块入口，不在任务内领取 | P2 | 🤖 |
| TASK-015 | 单聚合块容错 | 某聚合数据源异常 | buildAggregatedCards 各块独立 try/catch，单块失败不拖垮整页 | P1 | 🤖 |
| TASK-016 | 任务多语言 | 切 en/zh-CN/vi/id | social 三任务（follow_telegram/facebook/viber）及原生任务标题副标题按语言切换，无键名裸串 | P2 | 🤖 |
| TASK-017 | 首页任务浮球 | 首页观察任务悬浮球 | 浮球默认右上、可拖动、松手吸附边缘；红点=未完成任务数；点击扇形展开三入口 | P2 | 👤 |
| TASK-018 | 浮球贴边 TASKS 竖条 | 展开后点 X 收起 | 收进右边缘 TASKS 竖条控件；点竖条滑出还原；整个挂件即关闭热区（修小 X 点不中） | P2 | 👤 |
| TASK-019 | 后台任务配置三 tab | 后台任务中心改配置 | newbie/daily/social 三 tab 与前台三区一一对应；改阈值/奖励保存后前台 `/tasks` 同步 | P1 | 🤖 |
| TASK-020 | 后台截图人工审核 | social tab 审核队列 | `/admin/tasks/manual-reviews` 列表可通过/驳回；通过后对应用户任务入账 | P2 | 🤖 |

---

## 十五、VIP 成长中心（原洗码页升格为 VipPage）

> 等级扩至 **9 级**，按**每币种独立**累计有效流水（含 task_growth）判级。权益（bg_vip_level_benefit，按币种）：晋级礼金 / 周俸 / 月俸 / 生日礼金 / 保级线 / 提现日额度·次数。C 端接口 `/vip/levels`、`/vip/progress`、`/vip/rewards`、`POST /vip/claim`；洗码沿用 `/rebate/*`。原独立 loss-rebate 页已删并入 VIP 页负盈利 tab（见十六章）。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| VIP-001 | 9 级体系与进度 | 打开 VIP 页 | `/vip/levels` 返回 LV1-9；`/vip/progress` 当前级、距下级流水、进度条正确；LV1 阈值 0 | P1 | 🤖 |
| VIP-002 | 每币种独立等级 | 同账号 PHP 与 USDT 各有不同流水 | 切币种时等级/进度按该币种独立账拉取，互不影响（迁移 141） | P1 | 🤖 |
| VIP-003 | 晋级礼金补发 | 流水跨过多级阈值 | awardPromotionBonus 按已发放最高级到当前级差，补发中间每级 promotion_bonus，幂等不重发 | P1 | 🤖 |
| VIP-004 | 周俸门槛防躺领 | 当期有效流水 < 保级线/13 | 周俸不发；达门槛才发到 pending，领取有效期 7 天 | P1 | 🤖 |
| VIP-005 | 月俸门槛 | 当期有效流水 vs 保级线/3 | 达门槛发月俸 pending，有效期 14 天；未达不发 | P1 | 🤖 |
| VIP-006 | 生日礼金 KYC 同步 | KYC approved 且证件 dob 命中今日 | 从 bg_kyc.gemini_result.document.dob 懒回填 birthday 后发放，每年一次；**不接受用户手输生日** | P2 | 🤝 |
| VIP-007 | 季度硬降级封顶一级 | 当季流水增量 < 保级线且 current≥awarded | runQuarterlyRetention 每季每人一次，最多降 1 级，降到 awarded−1 触底不再下掉 | P1 | 🤖 |
| VIP-008 | 降级后回升 | current<awarded 且当季流水≥保级线 | 回升 1 级；达历史新高时 current 跟进覆盖过去降级 | P1 | 🤖 |
| VIP-009 | VIP6+ 专属客服标识 | 账号等级≥6 | 前端 prioritySupport=true，展示专属客服权益 | P2 | 🤖 |
| VIP-010 | 提现额度/次数按级 | 不同等级发起提现 | withdraw_daily_limit / withdraw_daily_count 按当前等级权益生效 | P1 | 🤝 |
| VIP-011 | 待领礼金统一领取 | 有 pending 的晋级/周俸/月俸/生日/负盈利礼金 | `POST /vip/claim` 一次性入账全部 pending（creditWalletTx type=vip_bonus）；重复点不重复入账 | P0 | 🤖 |
| VIP-012 | 礼金币种记录显示 | 领取多币种礼金后查记录 | VIP 礼金记录按币种正确显示金额（修复 2c27034） | P2 | 🤖 |
| VIP-013 | benefits 卡片交互 | 横滑权益卡 | 卡片加高、默认居中当前等级 | P2 | 👤 |
| VIP-014 | 后台权益配置按币种 | 后台 VIP 权益页切 PHP/USDT/USDC | 币种切换器生效，各币种权益独立保存；`PUT /admin/vip/benefits` 前台同步 | P1 | 🤖 |
| VIP-015 | 后台手动跑批 | 后台触发 weekly/monthly/birthday/retention manual | 各 `POST /admin/vip/*/manual` 按币种正确生成 pending，不重复 | P1 | 🤖 |

---

## 十六、负盈利返水（Net-loss Rebate，VIP 页负盈利 tab）

> 路线A·每日：净输按**昨天整日**结算，费率默认 **5%**（后台可配、全等级统一、无上限），近 **7 天滚动存款**窗口用于门槛与封顶。品类白名单默认 slots/fishing（排除 live/sports 防对赌）。领取门槛=近 7 天累计有效存款≥minDeposit（PHP 默认 50）。封顶 cap_to_deposit=true → 基数=LEAST(净输, 近7天存款)×费率。预览接口 `GET /vip/loss-rebate-status`，领取走 `POST /vip/claim`，后台手动结算 `POST /admin/vip/negative-rebate/manual`。配置 `bg_promo_config` promo_id='loss_rebate'。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| NLR-001 | C 端实时预览 | VIP 页负盈利 tab | `/vip/loss-rebate-status` 返回 netLoss/windowDeposit/potentialRebate/eligible/reason；显示今日净输、预计可返 | P1 | 🤖 |
| NLR-002 | 不可领原因展示 | 分别构造 disabled/no_loss/need_deposit/pending 场景 | reason 各自回对文案：活动关/无净输/存款未达门槛/待结算 | P1 | 🤖 |
| NLR-003 | 费率与全等级统一 | 不同 VIP 等级各查预览 | 返水率均为配置的统一值（默认 5%），不再按等级差异化（negative_rebate_pct 已停用） | P1 | 🤖 |
| NLR-004 | 品类白名单 | 分别在 slots/fishing 与 live/sports 产生净输 | 仅白名单品类计入净输基数；live/sports 不计（按 round_id 归属 sort_category） | P0 | 🤖 |
| NLR-005 | 存款门槛闸 | 近 7 天存款 < minDeposit | reason=need_deposit，不可领；达门槛后可领 | P0 | 🤖 |
| NLR-006 | 净存款封顶 | 净输 > 近 7 天累计存款 | 返水基数=近 7 天存款而非净输（LEAST 取小）×费率 | P0 | 🤖 |
| NLR-007 | 滚动窗口非当日闸 | 仅前几日有存款、当日无存款但有净输 | 近 7 天滚动窗口内存款满足门槛即可领（方案2 松绑当日存款闸） | P1 | 🤖 |
| NLR-008 | 扣减已结算金额 | 今日已结算/已领部分后再查预览 | remainingEstimate = max(0, potentialRebate − todaySettled)，不把已结算重复算进"还能返" | P0 | 🤖 |
| NLR-009 | 领取入账 | 有 pending 负盈利返水 | `POST /vip/claim` 入账（type=vip_bonus / negative_rebate）；重复点不重复入账 | P0 | 🤖 |
| NLR-010 | 每日 cron 结算 | 到 settleHour（默认 PHT 0 点） | runDailyLossRebate 结算昨天整日净输，写 bg_vip_reward_log status=pending，不自动入账 | P0 | 🤖 |
| NLR-011 | 后台手动结算 | 后台点立刻结算（includeToday 开/关） | `/admin/vip/negative-rebate/manual` 结算今日至今或昨天整日；C 端无"立刻结算"按钮（仅后台） | P1 | 🤖 |
| NLR-012 | 门槛按币种 | USDT 账号净输 | min_deposit_usdt（默认 0.86）等按币种取值，不用 PHP 阈值（迁移 143） | P1 | 🤖 |

---

## 十七、每日签到（Daily Check-in）

> 双轨 base/enhanced：增强轨达标=当日有存款 **或** 当日有效投注流水≥enhancedMinPhp（默认 100 PHP，跨币种折 PHP）。7 日固定小周期（day1-6 base=starter+enh=premium；day7 峰值 base=premium+enh=elite）。30 日里程碑（第 7/15/30 天=premium/elite/elite×3，按当月累计签到天数）。主奖=**转盘次数**（bg_spin_chance）。签到转盘 kind='checkin'，starter/premium/elite 三档独立奖池。接口 `GET /promotions/checkin/status`、`POST /promotions/checkin/claim`（前置风控）。配置 `bg_admin_settings.checkin_config`。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| CKIN-001 | 签到状态 | 打开签到弹窗/活动卡 | `/promotions/checkin/status` 返回连签天数、今日可签、7 日周期与里程碑进度 | P1 | 🤖 |
| CKIN-002 | 基础轨签到 | 当日无存款无流水直接签到 | 领 base 档（day1-6=starter），发对应转盘次数；连签+1 | P1 | 🤖 |
| CKIN-003 | 增强轨升级补发 | 先签 base，当日再产生存款或流水≥100PHP | canUpgradeToday 允许升级补发 enh 档差额 | P1 | 🤝 |
| CKIN-004 | 第 7 天峰值 | 连签到第 7 天 | base=premium、enh=elite 峰值奖励发放 | P1 | 🤖 |
| CKIN-005 | 月度里程碑 | 当月累计签到达 7/15/30 天 | 分别额外发 premium/elite/elite×3，独立于连签 | P2 | 🤖 |
| CKIN-006 | 主奖=转盘次数 | 签到领取后查 | bg_spin_chance 增加（source_order_id 幂等），转盘页次数同步；文案讲清领的是抽奖次数 | P0 | 🤖 |
| CKIN-007 | 签到转盘专用档 | 从签到进入转盘 | 默认选中 kind='checkin' 对应 checkin_tier 档；三档奖池独立；无档回落最小启用档 | P1 | 🤖 |
| CKIN-008 | 重复签到防重 | 当日已签再点 | 409 already claimed，不重复发次数 | P0 | 🤖 |
| CKIN-009 | 断签重置 | 隔日未签后再签 | 连签归 1 | P2 | 🤖 |
| CKIN-010 | 活动关闭 | 后台关签到 | claim 返回 403 disabled；前台入口/弹窗不再弹 | P1 | 🤖 |
| CKIN-011 | 后台配置 | 后台改每日奖励/阈值/里程碑 | checkin_config 保存后前台生效；周期天数固定 7 不可改 | P1 | 🤖 |
| CKIN-012 | 签到弹窗设计稿 | 首次进站/复访弹窗 | 皇家紫全屏定高弹窗，Your Spins/This Week/里程碑卡展示正确 | P2 | 👤 |

---

## 十八、复充限时优惠（Redeposit / redep）

> 复充人群判定**排除后台加款**（channel='admin' 不算首充人群）。进站弹窗+倒计时+充值面板角标。门槛按币种（迁移 143）。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| REDEP-001 | 复充弹窗与倒计时 | 已首充用户进站，活动开启 | 弹复充限时弹窗+倒计时；充值面板显示复充角标 | P1 | 🤝 |
| REDEP-002 | 复充人群判定 | 仅被后台加款(channel='admin')、无真实充值的用户 | 不被判为已首充人群，不误弹复充框（修复 8b0f119） | P1 | 🤖 |
| REDEP-003 | 复充奖励发放 | 达复充条件充值 | 按配置发放复充奖励一次+打码要求 | P0 | 🤝 |
| REDEP-004 | 复充按币种 | USDT 账号复充 | 门槛/奖励按 USDT 配置取值，非 PHP | P1 | 🤖 |

---

## 十九、多币种激励与钱包（PHP / USDT / USDC）

> 阶段 1-7：等级/VIP/Cashback/任务(留存)/复充/转盘奖池/负盈利均改「每币种独立账」，拉新类固定 PHP（见 [[project_acquisition_promo_php_only]]）；风控审核+签到门槛跨币种折 PHP 等值。568win 稳定币玩 USD 游戏（USDT/USDC 挂 USD agent 1:1，账号后缀 U/C）。钱包币种收敛为 PHP/USDT/USDC(+TRX 测试链)，虚拟币 TON/BNB/ETH/BTC/TLK 已下线。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| CUR-001 | 留存活动按币种 | 切 PHP/USDT/USDC 看 VIP/Cashback/任务/复充/负盈利 | 各币种档位矩阵/门槛/奖励按 activeCurrency 独立拉取 | P1 | 🤖 |
| CUR-002 | 拉新固定 PHP | 试玩金/App下载/首充在非 PHP 币种下 | 仍按 PHP 单币种一次性发放，不按币种化 | P1 | 🤖 |
| CUR-003 | 风控/签到跨币种折 PHP | USDT 流水触发签到增强轨/风控阈值 | 按 USDT_TO_PHP_RATE 折 PHP 等值判定（闭合稳定币漏判） | P1 | 🤖 |
| CUR-004 | 稳定币配置合并 | 后台改 USDT 营销值 | USDT/USDC 共用一套配置+镜像同步（ba95c24） | P1 | 🤖 |
| CUR-005 | 568win 稳定币玩 USD 游戏 | USDT 钱包启动 568win 游戏 | launch 透传 currency，选 USD agent（后缀 U）；bg_aggregator_player 每用户每币种一条映射（迁移 140） | P0 | 🤝 |
| CUR-006 | 无缝钱包回调对钱包 | USDT 游戏下注/派彩回调 | 回调按会话币种读对应 USDT 钱包扣加，不串 PHP 钱包 | P0 | 🤝 |
| CUR-007 | 转盘奖池每币种独立 | 不同币种抽转盘 | 奖池按币种独立配置（迁移 144） | P1 | 🤖 |
| CUR-008 | 菜单 VIP 卡片币种 | 切 activeCurrency | 菜单卡片 VIP 头按当前币种显示等级（修币种盲 f7ad28d） | P2 | 🤖 |
| CUR-009 | 虚拟币入口下线回归 | 钱包/充值/提现各页 | 无 TON/BNB/ETH/BTC/TLK/TRX 主网入口与文案（仅 PHP/USDT/USDC+TRX 测试链） | P1 | 🤖 |

---

## 二十、高返水游戏（High Cashback Games）

> Cashback 三档 2%/1.5%/1%（elite/pro/basic）。首页高返水区（三档各 3 款）+ games 页高洗码一级菜单（2%/1.5%/1% 二级）。后端 listGames 增 cashbackTier 过滤；tier=all 时分档配额轮播（每轮 elite2:pro3:basic4 从各档按热度轮流取）。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| HCB-001 | 首页高返水区 | 打开首页 | 三档各 3 款展示，卡片带 2%/1.5%/1% 奖牌角标 | P2 | 🤖 |
| HCB-002 | games 页高洗码菜单 | Games 页点高洗码一级 | 二级菜单 2%/1.5%/1% 切换，列表按 `listGames?cashbackTier=` 过滤正确 | P1 | 🤖 |
| HCB-003 | All 混合分档轮播 | 高洗码 tier=all | 每轮按 elite2:pro3:basic4 从各档（档内按热度）轮流取，三档持续穿插 | P2 | 🤖 |
| HCB-004 | X cashback 标签 | All 列表卡片 | 卡片标 X% cashback 标签，与该游戏实际档位一致 | P2 | 🤖 |
| HCB-005 | 精选选品扩量口径 | 对比选品脚本 v3 结果 | 2% 档 9 款 / 1.5% 档 30 款 / 1% 档不变，与线上一致 | P2 | 🤖 |
| HCB-006 | 返水计算按精选档 | 玩精选游戏产生流水 | 洗码按精选覆盖档（elite2%/pro1.5%/basic1%）计，非大类默认率 | P1 | 🤖 |

---

## 二十一、风控中心（Risk Control）

> 管控点 login / promo_claim / withdraw。动作等级 deny(403 risk_denied) > escalate(放行+提现转人工) > limit > tag_only(仅日志)。新规则默认影子模式 tag_only，后台改成 deny/escalate 转正式拦截。自动打标 core-node `recomputeRiskSignals` 每日全量重算，人工标 source='manual' 不被覆盖。后台 risk/overview·users·blacklist·policies(super_admin)·hits。**风控异常一律 pass 不拖垮主链路**。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| RISK-001 | 名单命中拦登录 | 用户/IP 在 deny 名单 | 登录 403 "Account access denied" | P0 | 🤖 |
| RISK-002 | 名单命中拦领取 | deny 名单用户领任务/签到/转盘/活动 | promo_claim 各入口 403 risk_denied，不入账 | P0 | 🤖 |
| RISK-003 | 名单命中拦提现 | deny 名单用户提现 | withdraw 403 risk_denied | P0 | 🤖 |
| RISK-004 | escalate 提现转人工 | 命中 escalate 规则 | 提现不阻断但落日志并进人工审核队列 | P1 | 🤖 |
| RISK-005 | tag_only 影子模式 | 新规则 action=tag_only | 只落 bg_risk_hit_log，不阻断任何动作 | P1 | 🤖 |
| RISK-006 | 影子转正式 | 后台 `PUT /admin/risk/policies` 改 tag_only→deny | 同场景开始返回 403 拦截 | P1 | 🤖 |
| RISK-007 | 自动打标跑批 | core-node recomputeRiskSignals | bonus_abuse(minRatio1.5)/multi_account(minSharedUsers3) 自动写 bg_user_risk_signal + bg_user_tag source='auto'；risk_score 0-100 | P1 | 🤖 |
| RISK-008 | 人工标不被覆盖 | 手动加 source='manual' 标签后跑批 | 自动跑批绝不覆盖/撤销人工标 | P1 | 🤖 |
| RISK-009 | 后台风控中心 | 各 risk/* 页 | overview 标签分布+近24h命中、users 画像、blacklist 增删、hits 命中日志正常 | P1 | 🤖 |
| RISK-010 | policies 需 super_admin | finance/ops 访问策略修改 | `PUT /admin/risk/policies` 及打标增删 requireRole('super_admin')→403 | P0 | 🤖 |
| RISK-011 | 用户画像加入/移出名单 | 风控画像页操作名单 | 增删名单即时生效，提现 upline_blacklist 联动（ADM-015） | P1 | 🤖 |
| RISK-012 | 风控异常兜底 | MySQL 未启用/评估抛错 | evaluateCheckpoint 返回 pass，登录/领取/提现主链路不被拖垮 | P0 | 🤖 |

---

## 二十二、设备指纹与人机验证

> 登录链路采集 device_id/fp_visitor/signals 落库；提现审核 same_ip_device 加设备阈值维度。注册启用 Cloudflare Turnstile，已删除注册同 IP/同设备频控。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| FP-001 | 指纹采集落库 | 登录 | device_id/fp_visitor/signals 写入登录记录 | P1 | 🤖 |
| FP-002 | 后台指纹/IP 查询页 | 后台按指纹/IP/user_id 查 | 返回关联账号全量列表；用户详情/登录记录展示指纹可点击跳转 | P1 | 🤖 |
| FP-003 | 提现设备维度审核 | 同设备多账号提现 | same_ip_device 命中含 device 阈值（deviceTh=设备账号总数含本人）转人工 | P1 | 🤖 |
| FP-004 | 注册 Turnstile 验证 | 浏览器注册 | 需通过 Turnstile 人机验证；密钥未配置时默认关不拦 | P1 | 👤 |
| FP-005 | 注册无 IP/设备频控 | 同 IP 连续注册 | 不再触发注册频控（已移除），仅 Turnstile 拦人机 | P2 | 👤 |

---

## 二十三、首席体验官弹窗 & 弹窗调度补充

> 首席体验官进站弹窗送礼金，领取前先绑手机号（短信验证）；纳入后台首页弹窗配置 popups.trial（开关+人群：未充值用户或游客）。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| TRIAL-001 | 首席体验官弹窗弹出 | 未充值用户/游客，popups.trial 开 | 按后台人群配置自动弹出送礼金弹窗（紫色渐变） | P1 | 🤖 |
| TRIAL-002 | 领礼金前绑手机 | 点领取 | 先要求绑定手机号+短信验证码，验证通过后发礼金 | P0 | 👤 |
| TRIAL-003 | 后台弹窗调度 | 后台配 popups 开关/顺序/人群 | 前台弹窗按配置出现/隐藏；人群命中正确 | P1 | 🤖 |
| TRIAL-004 | 首充悬浮入口配置 | 后台首页弹窗配置纳入首充入口 | 首充悬浮入口按开关+人群展示 | P2 | 🤖 |

---

## 二十四、后台新增/变更补充

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| ADM2-001 | 重置用户登录密码 | 后台用户详情 | 管理员可重置 C 端用户登录密码，用户用新密码可登录、旧密码失效 | P1 | 🤖 |
| ADM2-002 | 分页每页条数下拉 | 各后台分页表 | 默认 20，可选 20/50/100/200/500/1000 | P2 | 🤖 |
| ADM2-003 | 厂商权重排序 | 后台厂商列表 / C 端厂商菜单 | 均按 bg_provider 权重排序；后台可维护权重与厂商简称 | P1 | 🤖 |
| ADM2-004 | 厂商名数据层统一 | 撞名厂商 | display 名统一，provider_match=false 竞品权重封顶 7000，不虚高 | P2 | 🤖 |
| ADM2-005 | 后台移动端视图 | 手机浏览器开后台 | 响应式地基+PWA；高频页移动卡片视图、筛选栏/统计行响应式 | P2 | 👤 |
| ADM2-006 | 风控规则说明列 | 后台风控策略列表 | 策略列表含「规则说明」列 | P2 | 🤖 |
| ADM2-007 | 活动配置统一列表 | 后台常规活动列表 | 开关/排序/人群统一驱动前台 bonuses 卡片顺序（39eedee） | P1 | 🤖 |
| ADM2-008 | 注册登录入口来源 | 后台看用户 | 展示并记录用户注册/登录入口来源网址 | P2 | 🤖 |

---

## 二十五、下线/移除业务回归

> 确认已删业务的入口彻底消失、且删除未误伤主链路。

| 编号 | 用例名称 | 前置 / 操作 | 预期结果 | 优先级 | 执行 |
|---|---|---|---|---|---|
| REG-001 | 邀请奖金业务下线 | 分销/活动页 | 无 "Invite & Earn Together" 邀请奖金入口（与 3-Circle 三级分销冲突已删 bf3917d） | P1 | 🤖 |
| REG-002 | 存款侧转盘抽奖下线 | 充值流程 | 仅保留每日签到转盘，删除存款侧转盘抽奖（39aac97） | P1 | 🤖 |
| REG-003 | Slotegrator 聚合商下线 | 游戏列表 | 无 Slotegrator 游戏/配置（迁移 137），死脚本已清 | P2 | 🤖 |
| REG-004 | 旧分类大厅退役 | 深链/运营位 | SlotsLobby 退役，运营位与深链统一并入 games 页（500e991） | P1 | 🤖 |
| REG-005 | Maya 渠道充值奖励移除 | 充值 | 移除 chdep 渠道奖励（与首充送冲突 1f83c31），首充送正常 | P1 | 🤖 |
| REG-006 | 首页社交位改写死 | 首页/菜单社区入口 | 社区图标写死接真实外链（TG betogo_gaming/Viber 群/Facebook），删后台首页装修社交链接配置逻辑 | P2 | 🤖 |
| REG-007 | 虚拟币业务下线 | 后端/DB/后台/core | TON/BNB/ETH/BTC/TLK/TRX 主网充提代码与配置已移除，无残留死代码报错 | P1 | 🤖 |
| REG-008 | 无用表清理 | DB | 迁移 145 清理 19 张无用表后，主链路接口无因缺表报错 | P1 | 🤖 |
| REG-009 | chunk 加载自愈 | 发版后旧客户端 | 懒加载 chunk 失败自动刷新自愈，无部署后黑屏（053ff32） | P1 | 🤝 |
