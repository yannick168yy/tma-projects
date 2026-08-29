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

/** 支持菲律宾与印尼手机号；显式国家码优先，本地 09xx/08xx 可直接识别。 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s()-]/g, '')
  if (s.startsWith('+62') || s.startsWith('62') || s.startsWith('08') || /^8\d{8,11}$/.test(s)) {
    return normalizePhoneID(s)
  }
  return normalizePhonePH(s)
}
