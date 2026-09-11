/**
 * 演示站数据规则。
 *
 * 🔴 源库里的每一张表都必须在这里出现。02-mask.mjs 启动时会比对，
 * 漏了任何一张就直接报错退出 —— 否则以后新增的表会带着真实数据静默进演示库。
 */

/** 配置与参考数据：内容是平台预置的，不含任何单个用户的痕迹，原样复制 */
export const COPY = [
  'bg_admin_settings', 'bg_promo_config', 'bg_turnover_requirements', 'bg_game_turnover_rates',
  'bg_rebate_config', 'bg_rebate_level_config', 'bg_rebate_level_threshold', 'bg_rebate_featured_game',
  'bg_firstdep_tiers', 'bg_redep_tier', 'bg_redep_offer', 'bg_regular_redep_tier',
  'bg_spin_deposit_rule', 'bg_spin_prize', 'bg_spin_config', 'bg_task_social',
  'bg_risk_policy', 'bg_team_config', 'bg_team_rate_plan', 'bg_withdraw_review_config',
  'bg_home_content', 'bg_home_content_image', 'bg_homepage_frozen_board',
  'bg_homepage_section_game', 'bg_homepage_section_visibility', 'bg_bottom_nav',
  'bg_category_sort_game', 'bg_virtual_game_config', 'bg_vip_level_benefit',
  'bg_568win_provider', 'bg_568win_game', 'bg_568win_game_override', 'bg_568win_game_cover_candidate',
  'bg_game_catalog', 'bg_game_provider', 'bg_game_route_rule', 'bg_game_source',
  'payment_channels', 'payment_channel_rules',
  'cs_faq', 'bg_announcement', 'bg_exchange_rate', 'cm_template', 'cm_rule',
  'bg_user_id_seq',
]

/**
 * 不复制，留空表。分三种理由，混在一起会让后来者以为是漏了。
 */
export const SKIP = {
  admin_accounts: '开站已建 demoadmin。复制等于把演示后台连着生产管理员一起交出去',
  admin_audit_log: '管理员操作明细，含调额、审批的完整轨迹',
  schema_migrations: '重置流程单独处理：导快照后要补跑迁移，版本记录不能来自快照',
  bg_idempotency: '幂等键，无演示价值',

  // 第三方原始报文：非结构化 JSON，逐字段脱敏的思路覆盖不到，且可能含密钥
  bg_568win_agent: '聚合商子代理凭据，raw_response 里是密钥',
  bg_568win_wallet_txn: 'raw_request 是聚合商原始报文，含玩家账号',
  bg_aggregator_player: 'raw_response 同上',
  bg_payment_callback_issue: 'detail 是支付商原始回调报文',

  // 商业敏感：不是个人信息，但不该给潜在客户（也可能是同行）看
  provider_balance_snapshot: '支付商账户余额',
  provider_balance_snapshot_history: '同上',
  bg_ad_channel_price: '买量成本单价',
  bg_agent_ggr_monthly: '代理月度 GGR，结合代理名单能反推真实盘口规模',

  // 凭据类
  bg_capi_pixel_token: 'Facebook 转化回传 token',
  bg_agent_bot: '代理 TG 机器人 token',

  // 未合并到 main 的功能，演示不涉及
  bg_wxgame_game: 'WXGame 未上线',
  bg_wxgame_player_rtp: 'WXGame 未上线',
  bg_wxgame_recon_cursor: 'WXGame 未上线',
  bg_wxgame_recon_diff: 'WXGame 未上线',
  bg_wxgame_wallet_txn: 'WXGame 未上线',

  bg_pending_install: '安装归因中间态，含 client_ip，演示价值近零',
}

/**
 * bg_admin_settings 整表复制，但这些键绝不能带进演示库。
 * 与 tenant-provision.service.ts 的 SEED_PURGED_SETTINGS 同源，理由也一致。
 */
export const PURGED_SETTINGS = [
  'op_password', 'win568_operation_company_key', 'win568_sw_company_key',
  'site_domain_mappings', 'app_route_tg_channel',
  'win568_report_sync_watermark', 'win568_report_sync_coverage_start',
  'user_risk_signal_last_refresh', 'user_segment_last_refresh',
]

/**
 * COPY 里体积过大的表：带时间窗导，不要全量。
 *
 * 教训来自一次把测试机压到 load 16 的全量复制 —— bg_exchange_rate 有 5 万+ 行
 * 历史汇率，演示只需要近期的几条用来做金额换算。生产库上这类表只会更大，
 * 全量搬运会实打实影响在线用户。
 */
export const COPY_WINDOWED = {
  bg_exchange_rate: { column: 'created_at', days: 7 },
}

/**
 * 表里的凭据字段，复制后清空。字段不存在就跳过。
 *
 * 当前 schema 下 payment_channels 其实**不含**任何凭据（只有费率、限额、展示配置），
 * 真正的密钥在 bg_admin_settings（已由 PURGED_SETTINGS 清除）和平台库
 * pf_tenant_provider（不属于租户库，压根不在演示库范围内）。
 * 这份配置留着是防御性的：哪天有人往渠道表加了 api_key，这里能兜住。
 */
export const PURGED_COLUMNS = {
  payment_channels: ['merchant_id', 'api_key', 'secret_key', 'private_key', 'public_key', 'callback_secret'],
}

/**
 * 字段级脱敏规则。只列需要特殊处理的字段 —— 金额字段由引擎按类型自动识别缩放，
 * 不在这里逐个写（132 个 decimal 字段手写必漏）。
 *
 * 规则名对应 lib/mask.mjs 里的函数；'clear' 表示清空。
 */
export const MASK_FIELDS = {
  bg_user: {
    email: 'email', display_name: 'name', avatar_url: 'avatar',
    register_ip: 'ip', last_login_ip: 'ip', register_device_id: 'device',
  },
  // identifier 按 provider 分流：phone 走号段保留，telegram/google 是不透明 id
  // display_label 是自检抓出来的漏网之鱼：里面存着真实邮箱。
  // credential_hash 虽是哈希，但同一份口令在别处也能对上，一并换掉
  bg_user_identity: {
    identifier: 'identityByProvider', display_label: 'identityByProvider',
    credential_hash: 'preserve',
  },

  bg_kyc: { full_name: 'name', extracted_id_no: 'preserve', phone: 'phone' },
  bg_kyc_doc_log: { full_name: 'name' },
  bg_kyc_submission: { full_name: 'name' },

  // fp_visitor / fp_signals 是设备指纹，唯一性比 device_id 还强，必须一起换
  bg_login_log: {
    ip: 'ip', device_id: 'device', fp_visitor: 'device', fp_signals: 'clear',
    user_agent: 'clear',
  },
  bg_risk_hit_log: { device_id: 'device', detail: 'clear' },
  bg_app_download_claim: { device_id: 'device' },
  bg_user_attribution: { client_ip: 'ip' },

  // 资金账号
  bg_matrix_deposit_address: { address: 'addr' },
  bg_deposit_order: { from_address: 'addr', to_address: 'addr', extra: 'jsonMask' },
  bg_withdraw_order: { to_address: 'addr', extra: 'jsonMask' },

  // 黑名单存的是原值，按 type 决定怎么换
  bg_risk_blacklist: { value: 'blacklistByType' },

  // 代理是真实合作方，名称与推广域名都不能外露
  bg_agent: { name: 'name', remark: 'clear' },
  bg_agent_domain: { domain: 'fakeDomain', label: 'clear' },

  // 客服：聊天正文无法逐字段脱敏，整体换成预置假对话（见 lib/conversations.mjs）
  cs_conversation: { agent_name: 'name', ai_summary: 'clear' },
  cs_message: { content: 'fakeConversation' },

  // TG 与社群
  tg_broadcast_fail: { tg_id: 'extid' },
  cm_channel: { config: 'clear', name: 'clear' },

  // 聚合商原始报文：整表跳过的已在 SKIP，这张表要留着出注单报表，只清 raw
  bg_568win_report_bet: { raw_bet: 'clear', raw_response: 'clear' },
}

/**
 * extra JSON 的处理：白名单，不是黑名单。
 *
 * 🔴 这里原本写成黑名单（列出要脱敏的 key，其余原样），端到端验证时发现
 * bg_deposit_order.extra 里带着 `notifyRaw` —— 支付商回调的原始报文，
 * 含 RSA 加密数据、AES 密钥和签名，整段原封不动留在演示库里。
 * 黑名单对第三方结构必漏：支付商什么时候加个新字段，我们不会知道。
 *
 * 现在的规则：MASK 里的按规则脱敏，KEEP 里的原样保留，**其余一律删除**。
 */
export const JSON_MASK_KEYS = {
  targetAccount: 'bank', targetOwner: 'name', accountNo: 'bank', accountName: 'name',
  bankAccount: 'bank', cardNo: 'bank', holderName: 'name',
  phone: 'phone', email: 'email', address: 'addr', idNo: 'preserve',
}

/** 确认不含个人信息与凭据的 key，原样保留 —— 后台订单详情页要靠它们显示渠道 */
export const JSON_KEEP_KEYS = [
  'channelCode', 'channelName', 'platformId', 'providerRef',
  'finishTime', 'onChainTime', 'completedAt', 'depositStatusSync',
  'settlementMode', 'currency', 'amount',
]

/** 比率类：绝不能乘缩放系数，乘了就把返水率、汇率一起改错 */
export const NO_SCALE_PATTERN = /rate|ratio|pct|percent|multiplier|weight|rtp|confidence|deviation/i
