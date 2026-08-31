import { useEffect, useState } from 'react'
import { Gift, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { claimRegularRedep, fetchRegularRedepClaims, type RegularRedepClaim } from '@/api/promotion'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'

interface Props { currency: string; refreshKey?: number }

const text = {
  en: { title: 'Reload bonus ready', deposit: 'Deposit', bonus: 'Bonus', turnover: 'Required turnover', claim: 'Claim bonus', claiming: 'Claiming…', success: 'Bonus credited', expires: 'Claim before' },
  id: { title: 'Bonus isi ulang siap', deposit: 'Setoran', bonus: 'Bonus', turnover: 'Turnover diperlukan', claim: 'Klaim bonus', claiming: 'Memproses…', success: 'Bonus berhasil masuk', expires: 'Klaim sebelum' },
  'zh-CN': { title: '复充赠金待领取', deposit: '本次充值', bonus: '可领赠金', turnover: '所需流水', claim: '领取赠金', claiming: '领取中…', success: '赠金已到账', expires: '领取截止' },
  vi: { title: 'Thưởng nạp lại đang chờ', deposit: 'Tiền nạp', bonus: 'Tiền thưởng', turnover: 'Doanh thu yêu cầu', claim: 'Nhận thưởng', claiming: 'Đang nhận…', success: 'Đã cộng thưởng', expires: 'Nhận trước' },
} as const

function money(value: number, currency: string) {
  const amount = value.toLocaleString('en-US', { maximumFractionDigits: currency === 'IDR' ? 0 : 2 })
  return currency === 'PHP' ? `₱${amount}` : currency === 'IDR' ? `Rp ${amount}` : `${amount} ${currency}`
}

export default function RegularRedepClaims({ currency, refreshKey = 0 }: Props) {
  const token = useAuthStore((state) => state.token)
  const { i18n } = useTranslation()
  const lang = i18n.language.startsWith('id') ? 'id' : i18n.language.startsWith('zh') ? 'zh-CN' : i18n.language.startsWith('vi') ? 'vi' : 'en'
  const copy = text[lang]
  const [items, setItems] = useState<RegularRedepClaim[]>([])
  const [claiming, setClaiming] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const load = () => token ? fetchRegularRedepClaims(currency).then(setItems).catch(() => setItems([])) : Promise.resolve(setItems([]))
  useEffect(() => { void load() }, [token, currency, refreshKey])
  if (!items.length) return null
  return <div className="space-y-2">
    {items.map((item) => <div key={item.id} className="rounded-2xl border border-amber-400/35 bg-amber-400/10 p-3">
      <div className="flex items-center gap-2 text-amber-300"><Gift size={16} /><b className="text-sm">{copy.title}</b></div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-white/60">
        <div>{copy.deposit}<b className="block text-sm text-white">{money(item.depositAmount, item.currency)}</b></div>
        <div>{copy.bonus}<b className="block text-sm text-amber-300">+{money(item.bonusAmount, item.currency)}</b></div>
        <div>{copy.turnover}<b className="block text-sm text-white">{money(item.turnoverRequired, item.currency)}</b></div>
      </div>
      <div className="mt-2 text-center text-[10px] text-white/45">{copy.expires} {new Date(item.expiresAt).toLocaleString()}</div>
      <button type="button" disabled={claiming === item.id} onClick={async () => {
        setClaiming(item.id); setMessage('')
        try { await claimRegularRedep(item.id); await useWalletStore.getState().refresh(); setMessage(copy.success); await load() }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Failed') }
        finally { setClaiming(null) }
      }} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-2.5 text-sm font-black text-black disabled:opacity-60">
        {claiming === item.id && <Loader2 size={15} className="animate-spin" />}{claiming === item.id ? copy.claiming : copy.claim}
      </button>
      {message && <p className="mt-1 text-center text-[11px] text-amber-200">{message}</p>}
    </div>)}
  </div>
}
