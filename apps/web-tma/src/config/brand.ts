/**
 * 租户品牌与主题（P1-10）。由 `/site/config` 随 bootstrap 下发，
 * 在 `initSiteMarketConfig()` 里填充。
 */

export interface SiteBrand {
  siteName: string
  shortName: string
  logoTextPrimary: string
  logoTextAccent: string
  tagline: string
  logoLightUrl: string | null
  logoDarkUrl: string | null
  faviconUrl: string | null
  appIconUrl: string | null
}

/**
 * 兜底 = 自营站现有品牌。
 *
 * 这是**兜底**不是真相源：服务端下发的一律优先。留着它是为了
 * bootstrap 拉不到时站点不至于变成空标题、空 logo 的白板。
 */
const DEFAULT_BRAND: SiteBrand = {
  siteName: 'BETOGO',
  shortName: 'B',
  logoTextPrimary: 'BETO',
  logoTextAccent: 'GO',
  tagline: 'Bet. Go. Win',
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  appIconUrl: null,
}

let brand: SiteBrand = DEFAULT_BRAND

export function getBrand(): SiteBrand {
  return brand
}

export function getSiteName(): string {
  return brand.siteName
}

function str(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = raw[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function url(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function setSiteBrand(input: unknown): void {
  if (!input || typeof input !== 'object') return
  const raw = input as Record<string, unknown>
  brand = {
    siteName: str(raw, 'siteName', DEFAULT_BRAND.siteName),
    shortName: str(raw, 'shortName', DEFAULT_BRAND.shortName),
    logoTextPrimary: str(raw, 'logoTextPrimary', DEFAULT_BRAND.logoTextPrimary),
    logoTextAccent: str(raw, 'logoTextAccent', DEFAULT_BRAND.logoTextAccent),
    tagline: str(raw, 'tagline', DEFAULT_BRAND.tagline),
    logoLightUrl: url(raw, 'logoLightUrl'),
    logoDarkUrl: url(raw, 'logoDarkUrl'),
    faviconUrl: url(raw, 'faviconUrl'),
    appIconUrl: url(raw, 'appIconUrl'),
  }
}

/** 服务端主题变量键 → theme.css 里的 CSS 变量名。与 brand.service.ts 的 THEME_CSS_VAR 一一对应 */
const THEME_CSS_VAR: Record<string, string> = {
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  radius: '--radius',
  fontSans: '--font-sans',
  fontDisplay: '--font-display',
}

/**
 * 把租户主题写进 `:root`。
 *
 * theme.css 已经是 CSS 变量 + Tailwind v4 `@theme inline`，
 * 覆盖变量即可全站换色，不需要重新构建样式。
 *
 * 服务端已按白名单校验过取值；这里只认识白名单内的键，多余的键直接忽略 ——
 * 不把未知键透传进 setProperty，免得库里被手工写脏后影响页面。
 */
export function applySiteTheme(input: unknown): void {
  if (!input || typeof input !== 'object' || typeof document === 'undefined') return
  const root = document.documentElement
  for (const [key, cssVar] of Object.entries(THEME_CSS_VAR)) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) root.style.setProperty(cssVar, value.trim())
  }
}

/** 标题栏与 favicon。租户装成自己的站，这两处不改一眼就穿帮 */
export function applySiteIdentity(): void {
  if (typeof document === 'undefined') return
  document.title = brand.siteName
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', brand.siteName)
  if (brand.faviconUrl) {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) link.href = brand.faviconUrl
  }
}
