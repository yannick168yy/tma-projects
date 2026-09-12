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
