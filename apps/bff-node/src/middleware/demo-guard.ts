import type { Middleware } from 'koa'
import { currentTenantOrNull } from '../lib/tenant-context.js'

/**
 * 演示站的对外副作用闸门。
 *
 * 演示库里怎么点都无所谓 —— 数据是脱敏样本，每天还会重置。真正不能发生的是
 * **动作跑到演示库外面去**：拿假用户去真发 TG 广播、拿假订单号去问支付商、
 * 把整库备份下载走。
 *
 * 这里只管后台按钮触发的这一路。定时任务那一路不走 HTTP，由
 * listRunnableTenants 的 is_demo 过滤挡掉（那边是 16 个任务的唯一入口）。
 *
 * 拦截清单按「这个请求会不会打到第三方」来定，不按「是不是写操作」。
 * 改配置、审批提现、调余额这些纯 DB 写全部放行 —— 演示要的就是这些能点。
 */
const BLOCKED = [
  // TG / Viber：真的会把消息推给真实 TG 用户
  { re: /^\/api\/v1\/admin\/broadcast\/[^/]+\/(send|test)$/, why: 'TG 广播会真的发出去' },
  { re: /^\/api\/v1\/admin\/community\/channels\/[^/]+\/viber-webhook$/, why: '会向 Viber 注册回调地址' },
  { re: /^\/api\/v1\/admin\/cs\/conversations\/[^/]+\/reply$/, why: '客服回复会推送给真实用户' },
  { re: /^\/api\/v1\/admin\/agent\/bots(\/|$)/, why: '会拿 bot token 去 TG 验证' },

  // 整库备份：演示账号是 super_admin，这个页面对它可见，必须拦死
  { re: /^\/api\/v1\/admin\/db-backup(\/|$)/, why: '整库备份可被下载带走' },

  // 支付商：假订单号打到真实商户接口
  { re: /^\/api\/v1\/admin\/payment\/reconciliation\/[^/]+\/sync$/, why: '会调支付商对账接口' },
  { re: /^\/api\/v1\/admin\/payment\/balance\/(refresh|matrix)$/, why: '会调支付商查询商户余额' },

  // 聚合商：真实计费接口
  { re: /^\/api\/v1\/admin\/games\/win568-sync$/, why: '会调聚合商同步接口' },

  // AI：按调用量计费
  { re: /^\/api\/v1\/admin\/cs\/conversations\/[^/]+\/(summary|translate)$/, why: 'AI 接口按量计费' },
  { re: /^\/api\/v1\/admin\/cs\/translate-content$/, why: 'AI 接口按量计费' },
]

export function demoGuardMiddleware(): Middleware {
  return async (ctx, next) => {
    const tenant = currentTenantOrNull()
    if (!tenant?.isDemo) return next()

    const hit = BLOCKED.find((b) => b.re.test(ctx.path))
    if (!hit) return next()

    // 200 而不是 403：这不是权限不足，是演示环境有意为之。
    // 前端拿 403 会弹"无操作权限"，看演示的客人会以为是账号权限问题。
    ctx.status = 200
    ctx.body = {
      code: 0,
      message: `演示环境已拦截该操作：${hit.why}`,
      data: { demoBlocked: true, reason: hit.why },
      traceId: ctx.state.traceId,
    }
  }
}
