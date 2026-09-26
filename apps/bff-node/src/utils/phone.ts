import type { SiteMarket } from '../services/site-domain.service.js'

/** 归一化菲律宾手机号到 E.164：09xx→+639xx，63xx→+63xx，+63xx 原样。无效返回 null */
export function normalizePhonePH(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '')
  let digits: string
  if (s.startsWith('+63')) digits = s.slice(3)
  else if (s.startsWith('63')) digits = s.slice(2)
  else if (s.startsWith('0')) digits = s.slice(1)
  else digits = s
  // 菲律宾移动号码：9 开头，共 10 位
  if (!/^9\d{9}$/.test(digits)) return null
  return `+63${digits}`
}

/** 归一化印尼手机号到 E.164：08xx→+628xx，62xx→+62xx，+62xx 原样。无效返回 null */
export function normalizePhoneID(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '')
  let digits: string
  if (s.startsWith('+62')) digits = s.slice(3)
  else if (s.startsWith('62')) digits = s.slice(2)
  else if (s.startsWith('0')) digits = s.slice(1)
  else digits = s
  // 印尼移动号码：8 开头，国家码后通常 9-12 位
  if (!/^8\d{8,11}$/.test(digits)) return null
  return `+62${digits}`
}

/** 归一化印度手机号到 E.164：09xxxxxxxxx / 9xxxxxxxxx / 91xx / +91xx → +919xx。无效返回 null */
export function normalizePhoneIN(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '')
  let digits: string
  if (s.startsWith('+91')) digits = s.slice(3)
  else if (/^91\d{10}$/.test(s)) digits = s.slice(2)
  else if (s.startsWith('0')) digits = s.slice(1)
  else digits = s
  // 印度移动号码：6-9 开头，共 10 位
  if (!/^[6-9]\d{9}$/.test(digits)) return null
  return `+91${digits}`
}

/**
 * 显式国家码优先；本地写法按站点市场判定。
 * 印度的 09xxxxxxxxx / 9xxxxxxxxx 与菲律宾本地写法完全重叠，只能靠市场区分。
 */
export function normalizePhone(raw: string, market: SiteMarket = 'PH'): string | null {
  const s = raw.trim().replace(/[\s()-]/g, '')
  if (s.startsWith('+91') || /^91\d{10}$/.test(s)) return normalizePhoneIN(s)
  if (s.startsWith('+63') || s.startsWith('63')) return normalizePhonePH(s)
  if (market === 'IN') return normalizePhoneIN(s)
  if (s.startsWith('+62') || s.startsWith('62') || s.startsWith('08') || /^8\d{8,11}$/.test(s)) {
    return normalizePhoneID(s)
  }
  return normalizePhonePH(s)
}
