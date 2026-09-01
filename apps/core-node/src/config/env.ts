import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORE_PORT: z.coerce.number().default(4000),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  MYSQL_HOST: z.string().default('localhost'),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_DATABASE: z.string().default('betogo'),
  MYSQL_USER: z.string().default('betogo'),
  MYSQL_PASSWORD: z.string().default(''),

  NATS_URL: z.string().default('nats://localhost:4222'),
  NATS_STREAM: z.string().default('BETOGO'),
  NATS_LEDGER_SUBJECT: z.string().default('betogo.ledger'),
  NATS_CALLBACK_SUBJECT: z.string().default('betogo.callback'),

  // 568Win 聚合商
  WIN568_BASE_URL: z.string().default('https://test-api.568win.com'),
  WIN568_COMPANY_KEY: z.string().default(''),
  WIN568_SERVER_ID: z.string().default(''),
  WIN568_SW_COMPANY_KEY: z.string().default(''),
  WIN568_SW_ALLOWED_IPS: z.string().default(''),
  WIN568_DEFAULT_CURRENCY: z.enum(['PHP', 'IDR', 'USDT']).default('PHP'),

  // feature/免费旋转彩金薅羊毛闸：非平台活动派彩(IsGameProviderPromotion=false)中，
  // 单笔派彩 ÷ 触发注 ≥ MIN_MULTIPLE（小注爆奖=farming 签名）时，按 WAGER_MULT 倍补一条
  // 彩金流水锁；巨鲸大奖/正常小奖都是低倍，不受影响。MIN_AMOUNT 以下不查库、直接放行。
  FEATURE_BONUS_LOCK_ENABLED: z.string().default('true'),
  FEATURE_BONUS_LOCK_MIN_AMOUNT: z.coerce.number().default(50),
  FEATURE_BONUS_LOCK_MIN_AMOUNT_IDR: z.coerce.number().default(14400),
  FEATURE_BONUS_LOCK_MIN_MULTIPLE: z.coerce.number().default(20),
  FEATURE_BONUS_LOCK_WAGER_MULT: z.coerce.number().default(2),

  // YFPay 回调验签
  YFPAY_API_KEY: z.string().default(''),

  // UnisPay 印尼通道回调验签
  UNISPAY_API_KEY: z.string().default(''),

  // Matrix 通知密钥（入站验签解密）
  MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY: z.string().default(''),
  MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY: z.string().default(''),

  // 汇率兜底；业务统一以 USDT 为基准币种。
  USDT_TO_PHP_RATE: z.coerce.number().positive().default(58),
  EUR_TO_PHP_RATE:  z.coerce.number().positive().default(62),
  TRX_TO_PHP_RATE:  z.coerce.number().positive().default(19),
  USDT_TO_IDR_RATE: z.coerce.number().positive().default(16646),

  // 内部服务间通信 token
  INTERNAL_TOKEN: z.string().default(''),

  // ── 广告转化回传（CAPI）────────────────────────────────────────────────────
  // 像素 ID 由投放链接带入并存在 bg_user_attribution，这里只配 access token；
  // token 留空即关闭该平台回传。多条线共用一个 BM token 是 FB/TikTok 的正常用法。
  FB_CAPI_ACCESS_TOKEN: z.string().default(''),
  FB_CAPI_TEST_EVENT_CODE: z.string().default(''),
  TIKTOK_CAPI_ACCESS_TOKEN: z.string().default(''),
  TIKTOK_CAPI_TEST_EVENT_CODE: z.string().default(''),
  // 没有从链接带 px 进来时的兜底像素（一般留空）
  FB_PIXEL_ID: z.string().default(''),
  TIKTOK_PIXEL_ID: z.string().default(''),
})

const parsed = schema.parse(process.env)

if (parsed.NODE_ENV === 'production') {
  const missing: string[] = []
  if (!parsed.INTERNAL_TOKEN.trim()) missing.push('INTERNAL_TOKEN')
  if ((parsed.WIN568_COMPANY_KEY.trim() || parsed.WIN568_SERVER_ID.trim()) && !parsed.WIN568_SERVER_ID.trim()) {
    missing.push('WIN568_SERVER_ID')
  }
  if (parsed.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY.trim() !== '' || parsed.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY.trim() !== '') {
    if (!parsed.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY.trim()) missing.push('MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY')
    if (!parsed.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY.trim()) missing.push('MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY')
  }
  if (missing.length) throw new Error(`Unsafe production configuration: ${missing.join(', ')}`)
}

export const env = parsed
