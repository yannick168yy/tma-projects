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
