/**
 * 脱敏原语。核心是"确定性假值"：同一个真实值永远映射到同一个假值。
 *
 * 为什么不用星号打码：`0917****888` 会让后台的搜索、排序、唯一键全部失效，
 * 而且同一个用户在用户列表、充值单、客服会话里会变成三个看不出关联的记录，
 * 演示时根本点不进去。确定性映射保留了这些关系，同时因为带盐哈希不可逆，
 * 拿到演示库也反推不出真实值。
 */
import { createHash } from 'node:crypto'

const SALT = process.env.DEMO_MASK_SALT
if (!SALT || SALT.length < 16) {
  throw new Error('缺少 DEMO_MASK_SALT（至少 16 位）。盐值不入库、不进快照，每次刷新快照都要换新的 —— 同一个盐跨两次快照会让两批数据能关联比对')
}

/** 确定性整数：同输入同输出，跨进程稳定 */
function seed(kind, value) {
  const hex = createHash('sha256').update(`${SALT}|${kind}|${value}`).digest('hex')
  return parseInt(hex.slice(0, 12), 16)
}

function pick(list, kind, value) {
  return list[seed(kind, value) % list.length]
}

function digits(kind, value, n) {
  let out = ''
  let s = seed(kind, value)
  for (let i = 0; i < n; i++) {
    out += String(s % 10)
    s = Math.floor(s / 10) || seed(kind, `${value}:${i}`)
  }
  return out
}

/**
 * 保格式替换：长度、大小写、数字/字母的排布全部保留，内容全换。
 * 证件号、银行卡、各种业务单号都用它 —— 不必为每种证件写一套规则，
 * 而且后台那些「按长度校验」「按前缀分类」的展示逻辑不会因为脱敏而崩掉。
 */
export function preserveFormat(real, kind = 'fmt') {
  if (real == null || real === '') return real
  const str = String(real)
  let s = seed(kind, str)
  let out = ''
  for (const ch of str) {
    s = (s * 31 + 17) >>> 0
    if (ch >= '0' && ch <= '9') out += String(s % 10)
    else if (ch >= 'a' && ch <= 'z') out += String.fromCharCode(97 + (s % 26))
    else if (ch >= 'A' && ch <= 'Z') out += String.fromCharCode(65 + (s % 26))
    else out += ch  // 分隔符、加号、空格原样留着，格式才认得出
  }
  return out
}

// 号段保留：菲律宾 09xx / +639xx，印尼 08xx / +628xx。
// 保号段是有意为之 —— 后台按运营商分布出报表，全随机会让那张图变成噪声。
export function fakePhone(real) {
  if (!real) return real
  const str = String(real).trim()
  const m = str.match(/^(\+?\d{2,4}?)(\d{3})(\d+)$/)
  if (!m) return preserveFormat(str, 'phone')
  const [, cc, prefix, rest] = m
  return `${cc}${prefix}${digits('phone', str, rest.length)}`
}

export function fakeEmail(real) {
  if (!real) return real
  return `u${digits('email', String(real), 8)}@demo-mail.com`
}

const NAMES_PH = [
  'Juan Dela Cruz', 'Maria Santos', 'Jose Reyes', 'Ana Bautista', 'Pedro Ramos',
  'Rosa Mendoza', 'Carlo Aquino', 'Liza Garcia', 'Mark Villanueva', 'Grace Torres',
  'Ramon Castillo', 'Divina Flores', 'Noel Gonzales', 'Cecilia Cruz', 'Arnel Domingo',
]
const NAMES_ID = [
  'Budi Santoso', 'Siti Rahayu', 'Agus Wijaya', 'Dewi Lestari', 'Eko Prasetyo',
  'Rina Wulandari', 'Joko Susanto', 'Ayu Puspita', 'Bambang Hartono', 'Indah Permata',
  'Rudi Hermawan', 'Sri Mulyani', 'Andi Kurniawan', 'Nia Anggraini', 'Hendra Gunawan',
]

/** market 传 'ID' 走印尼名池，其余走菲律宾池 —— 名字和市场对不上一眼就假 */
export function fakeName(real, market) {
  if (!real) return real
  const pool = market === 'ID' ? NAMES_ID : NAMES_PH
  return pick(pool, 'name', String(real))
}

/** 保留前两段：后台按地区出的分布报表要还认得出国家，全随机会把那张图打散 */
export function fakeIp(real) {
  if (!real) return real
  const str = String(real)
  if (str.includes(':')) return preserveFormat(str, 'ip6')   // IPv6
  const parts = str.split('.')
  if (parts.length !== 4) return preserveFormat(str, 'ip')
  const s = seed('ip', str)
  // 不能用 >>：seed 返回 48 位整数，JS 位运算先截成 32 位有符号数，
  // 大数会变负，生成出 136.158.53.-50 这种非法 IP（实测踩到过）
  return `${parts[0]}.${parts[1]}.${s % 256}.${Math.floor(s / 256) % 254 + 1}`
}

export function fakeDeviceId(real) {
  if (!real) return real
  return preserveFormat(real, 'device')
}

/** TG / Google 这类第三方 id：纯数字或不透明串，保格式即可 */
export function fakeExternalId(real) {
  if (!real) return real
  return preserveFormat(real, 'extid')
}

/**
 * 链上地址。校验位算不对无所谓（演示库不会真发链上交易），
 * 但前缀要留着 —— 后台靠 T/0x 前缀区分 TRC20 与 ERC20 并选图标。
 */
export function fakeCryptoAddress(real) {
  if (!real) return real
  const str = String(real).trim()
  if (str.startsWith('0x')) return '0x' + preserveFormat(str.slice(2), 'addr').toLowerCase()
  if (str.startsWith('T')) return 'T' + preserveFormat(str.slice(1), 'addr')
  return preserveFormat(str, 'addr')
}

export function fakeBankAccount(real) {
  if (!real) return real
  return preserveFormat(real, 'bank')
}

const AVATAR_COUNT = 12
export function fakeAvatar(real) {
  if (!real) return real
  return `/assets/demo-avatars/a${(seed('avatar', String(real)) % AVATAR_COUNT) + 1}.png`
}

/**
 * 金额缩放。默认 1 = 不缩放，演示库的金额与源库逐字相同。
 *
 * 保留这个开关是因为演示对象里可能有同行，真实营收规模未必想给看。要开的话
 * 注意：配置表里的阈值（VIP 门槛、活动档位、返水门槛）必须跟着一起缩，
 * 02-mask.mjs 已经是这么做的。只缩金额不缩阈值会让 VIP 等级和累计流水对不上，
 * 点开用户详情立刻穿帮；而重算派生字段要复刻散在好几个 service 里的判定逻辑。
 *
 * 若要启用，建议取 0.5 这类能让配置缩完仍是整数的系数
 * （充 1000 送 100 → 充 500 送 50），0.3 会变成 300/30 这种一看就被动过的数。
 */
export const SCALE = Number(process.env.DEMO_AMOUNT_SCALE ?? 1)
export function scaleAmount(v) {
  if (SCALE === 1) return v
  if (v == null) return v
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return Math.round(n * SCALE * 100) / 100
}

/** 自检用：判断一个值是否还残留真实数据的特征 */
export function looksReal(value) {
  if (value == null) return false
  const s = String(value)
  return /@(gmail|yahoo|hotmail|outlook|qq|163)\./i.test(s)
    || /\b(0?9\d{9})\b/.test(s) && !s.startsWith('+63900')
}
