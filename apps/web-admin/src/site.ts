/**
 * 站点标识。
 *
 * web-admin 是所有租户共用的**同一份构建产物** —— 生产后台 admin.betogo.games
 * 与演示后台 demo-admin.betogo.games 指向同一个容器，所以标题不能写死，
 * 也没法用构建期的环境变量区分，只能在运行时按域名判断。
 *
 * 登录页的标题要在登录之前就显示，那时还没有 token、拿不到服务端的租户上下文，
 * 因此这里不走接口，直接看域名。约定：演示站的后台域名以 demo- 开头。
 */
export const IS_DEMO_SITE =
  typeof location !== 'undefined' && location.hostname.startsWith('demo-')

export const SITE_TITLE = IS_DEMO_SITE ? 'BetoGo 演示后台' : 'BetoGo 管理后台'

/** 侧边栏收起时的短标识与展开时的品牌名 */
export const SITE_BRAND = IS_DEMO_SITE ? '🎰 BetoGo 演示' : '🎰 BetoGo'
export const SITE_BRAND_MINI = IS_DEMO_SITE ? 'DEMO' : 'BG'

/**
 * 手机号打码，只在演示站生效。
 *
 * 演示库里的号码本就是假的（scripts/demo 已做确定性替换），打码是给看演示的人
 * 一个「这套系统不会把号码明晃晃摆出来」的交代。生产后台必须留全号 —— 客服
 * 核身份、财务对账都要照着念。
 *
 * 保留前 3 位（国家码/号段）与后 2 位，中间逐位换成 *，非数字字符原样留着，
 * 号码格式还认得出来。
 */
export function maskPhone(value: string | null | undefined): string {
  const s = value == null ? '' : String(value).trim()
  if (!IS_DEMO_SITE || !s) return s
  const total = (s.match(/\d/g) ?? []).length
  if (total < 7) return s   // 短号/内部编号打了码只会看不懂，不如原样
  let seen = 0
  return s.replace(/\d/g, (d) => {
    seen += 1
    return seen <= 3 || seen > total - 2 ? d : '*'
  })
}
