import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { Wallet, X, ArrowDownToLine, ArrowUpFromLine, History, CheckCircle2, AlertCircle, XCircle, Loader2, ArrowLeft, Send, ShieldCheck, Zap, Headphones, Copy, Check, Lock } from 'lucide-react'
import { createPortal } from 'react-dom'
import PayMethodGrid from '@/components/wallet/PayMethodGrid'
import { createDeposit } from '@/api/deposit'
import { createTonDeposit, pollTonDepositStatus } from '@/api/tonDeposit'
import { ApiError, isTelegramWebApp } from '@/api/client'
import { useWalletStore, formatBalanceWithCode } from '@/stores/wallet'
import { useTonConnect } from '@/hooks/useTonConnect'
import { openTelegramInvoice, waitForDepositPaid } from '@/utils/tgInvoice'
import { fetchYfDepositOrders, fetchYfWithdrawOrders, fetchDepositHistory, fetchWithdrawHistory } from '@/api/yfpay'
import { fetchPaymentChannels, fetchCryptoChannels, createPaymentDeposit, queryPaymentDeposit, createPaymentWithdrawal, type PaymentChannel } from '@/api/payment'
import { fetchTurnoverProgress, type TurnoverProgress } from '@/api/wallet'
import { fetchMatrixDepositAddress, createMatrixWithdrawal } from '@/api/matrix'
import { usePromotionStore } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'
import type { FirstDepTier } from '@/api/promotion'
import KycModal from '@/components/wallet/KycModal'
import { useKycGate } from '@/hooks/useKycGate'
import { CRYPTO_DEPOSIT, CRYPTO_WITHDRAW, FIAT_DEPOSIT, FIAT_WITHDRAW, TG_WALLET_DEPOSIT, type PayMethod } from '@/data/wallet'
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag'

interface Props { open: boolean; onClose: () => void }

interface HistoryItem { id: string; orderId: string; type: 'deposit'|'withdraw'; method: string; amount: string; date: string; sortKey: string; status: 'success'|'pending'|'rejected'|'admin_rejected'|'failed' }

function methodDisplayName(code: string) { const m: Record<string,string>={GCASH:'GCash',GCash:'GCash',gcash:'GCash',MAYA:'Maya',Maya:'Maya',maya:'Maya',BDO:'BDO Bank',BPI:'BPI Bank'}; return m[code]??code??'—' }
function formatOrderDate(iso: string) { try { return new Date(iso).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) } catch { return iso } }
function mapDepositState(state: number): HistoryItem['status'] { if(state===2)return 'success'; if(state===3)return 'rejected'; return 'pending' }
function mapWithdrawState(state: number): HistoryItem['status'] { if(state===1)return 'success'; if(state===2||state===3)return 'rejected'; return 'pending' }
function mapDepositStatus(status: string): HistoryItem['status'] { if(status==='paid'||status==='completed')return 'success'; if(status==='rejected')return 'rejected'; if(status==='admin_rejected')return 'admin_rejected'; if(status==='cancelled'||status==='failed')return 'failed'; return 'pending' }
function mapDepositChannelName(channelId: string) { const m: Record<string,string>={admin:'Admin',tg_wallet:'Telegram',ammer_pay:'Telegram',ton_connect:'TON',yfpay_gcash:'GCash',yfpay_maya:'Maya',yfpay_bdo:'BDO Bank',yfpay_bpi:'BPI Bank',yfpay_unknown:'YF Pay',matrix:'Matrix TRX'}; return m[channelId]??channelId??'—' }
const DEFAULT_DEPOSIT_AMOUNTS: Record<string,string>={tg_wallet_php:'1000',tg_wallet_usdt:'20',fiat_gcash:'500',fiat_maya:'500'}

// 各币种充值预设档位（与后台首充档位口径一致），用于充值金额网格
const DEPOSIT_PRESETS: Record<string, number[]> = {
  PHP: [20, 50, 100, 200, 500, 1000, 5000, 10000, 50000],
  USDT: [1, 5, 10, 50, 100, 500, 1000],
  USDC: [1, 5, 10, 50, 100, 500, 1000],
  TON: [1, 5, 10, 50, 100],
  TRX: [100, 500, 1000, 5000, 10000],
}
function currencySymbol(cur: string) { return cur === 'PHP' ? '₱' : cur === 'TON' ? 'TON' : cur === 'TRX' ? '' : '$' }
function fmtPreset(amount: number, cur: string) { const s = currencySymbol(cur); return cur === 'TON' || cur === 'TRX' ? `${amount.toLocaleString()} ${cur}` : `${s}${amount.toLocaleString()}` }
/** 向下匹配档位奖励：amount 命中的最大档位的奖励，无命中返回 0 */
function matchTierBonus(tiers: FirstDepTier[] | undefined, amount: number): number {
  if (!tiers || tiers.length === 0 || amount <= 0) return 0
  let bonus = 0, best = -1
  for (const tier of tiers) if (amount >= tier.depositAmount && tier.depositAmount > best) { best = tier.depositAmount; bonus = tier.bonusAmount }
  return bonus
}
type DepositCategory = 'ewallet' | 'crypto' | 'telegram'

function isPhoneWalletWithdraw(id: string | null) {
  return id === 'gcash-w' || id === 'maya-w'
}

function walletAccountFromPhone(e164: string | null): string {
  if (!e164) return ''
  if (e164.startsWith('+63')) return `0${e164.slice(3)}`
  return e164
}

function statusIconComp(status: string) { if(status==='success')return CheckCircle2; if(status==='pending')return Loader2; if(status==='rejected')return XCircle; return AlertCircle }
function fmtTurnoverAmount(amount: number, currency: string) {
  if (currency === 'PHP') return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `${parseFloat(amount.toFixed(6))} ${currency}`
}

export default function WalletModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const walletStore = useWalletStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const activeAvailable = useWalletStore((s) => {
    const b = s.balance?.balances.find((x) => x.currency === s.activeCurrency)
    return b?.available ?? 0
  })
  const displayActive = walletStore.balance ? formatBalanceWithCode(activeCurrency, activeAvailable) : '—'
  const { walletAddress: tonWalletAddress, isConnected: tonIsConnected, connectWallet: connectTonWallet, disconnect: disconnectTon, sendTransaction: sendTonTransaction } = useTonConnect()

  const sheetRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { onPointerDown, onPointerUp, onPointerCancel } = useBottomSheetDrag(open, onClose, sheetRef, backdropRef)

  const [tab, setTab] = useState<'deposit'|'withdraw'|'history'>('deposit')
  const [depositView, setDepositView] = useState<'select'|'input'>('select')
  const [depositCategory, setDepositCategory] = useState<DepositCategory>('ewallet')
  const promoConfig = usePromotionStore((s) => s.promoConfig)
  const loadPromoConfig = usePromotionStore((s) => s.loadPromoConfig)
  const firstDepClaimed = useAuthStore((s) => s.user?.firstDepClaimed)
  const isLoggedIn = useAuthStore((s) => Boolean(s.user))
  const [selectedMethod, setSelectedMethod] = useState<string|null>(null)
  const [amount, setAmount] = useState('')
  const [hasSuccessfulDeposit, setHasSuccessfulDeposit] = useState<boolean | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'all'|'deposit'|'withdraw'>('all')
  const [historyStatus, setHistoryStatus] = useState<'all'|'success'|'pending'|'rejected'|'admin_rejected'|'failed'>('all')
  const [depositLoading, setDepositLoading] = useState(false)
  const [depositMessage, setDepositMessage] = useState('')
  const [depositSuccess, setDepositSuccess] = useState(false)
  const [paymentDepositChannels, setPaymentDepositChannels] = useState<PaymentChannel[]>([])
  const [paymentWithdrawChannels, setPaymentWithdrawChannels] = useState<PaymentChannel[]>([])
  const [cryptoEnabled, setCryptoEnabled] = useState<Record<string, boolean>>({})
  const pollTimerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const [pollSerial, setPollSerial] = useState('')
  const tonLoadingRef = useRef(false)
  const [tonLoading, setTonLoading] = useState(false)
  const [tonMessage, setTonMessage] = useState('')
  const [tonSuccess, setTonSuccess] = useState(false)
  const tonPollTimerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const [withdrawAccount, setWithdrawAccount] = useState('')
  const [withdrawOwner, setWithdrawOwner] = useState('')
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [withdrawMessage, setWithdrawMessage] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState(false)
  const { kycApproved, kycOpen, setKycOpen, boundPhoneNumber, kycFullName, refreshKyc, onKycClose, onKycApproved } = useKycGate(open && tab === 'withdraw')
  const pendingWithdrawMethodRef = useRef<string | null>(null)
  const [historyOrders, setHistoryOrders] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [matrixAddress, setMatrixAddress] = useState('')
  const [matrixAddressLoading, setMatrixAddressLoading] = useState(false)
  const [matrixCryptoAmount, setMatrixCryptoAmount] = useState('')
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [turnoverProgress, setTurnoverProgress] = useState<TurnoverProgress | null>(null)
  const [turnoverLoading, setTurnoverLoading] = useState(false)
  const [turnoverShake, setTurnoverShake] = useState(false)

  function stopPolling() { if(pollTimerRef.current){clearInterval(pollTimerRef.current);pollTimerRef.current=null} }
  function stopTonPolling() { if(tonPollTimerRef.current){clearInterval(tonPollTimerRef.current);tonPollTimerRef.current=null} }

  function applyWithdrawPrefill(methodId: string, fullName?: string | null) {
    if (isPhoneWalletWithdraw(methodId)) {
      if (boundPhoneNumber) setWithdrawAccount(walletAccountFromPhone(boundPhoneNumber))
      else setWithdrawAccount('')
      const name = fullName ?? kycFullName
      setWithdrawOwner(name?.trim() ?? '')
    } else {
      setWithdrawAccount('')
      setWithdrawOwner('')
    }
  }

  function proceedWithWithdrawMethod(id: string, fullName?: string | null) {
    setSelectedMethod(id)
    setAmount('')
    setWithdrawMessage('')
    applyWithdrawPrefill(id, fullName)
  }

  async function onSelectWithdrawMethod(id: string) {
    if (turnoverProgress !== null && !turnoverProgress.canWithdraw) {
      setTurnoverShake(true)
      setTimeout(() => setTurnoverShake(false), 500)
      return
    }
    let status = kycApproved === null ? await refreshKyc() : null
    const approved = status ? status.status === 'approved' : kycApproved === true
    if (!approved) {
      pendingWithdrawMethodRef.current = id
      setKycOpen(true)
      return
    }
    proceedWithWithdrawMethod(id, status?.fullName ?? kycFullName)
  }

  async function handleKycApproved() {
    onKycApproved()
    const status = await refreshKyc()
    const pending = pendingWithdrawMethodRef.current
    if (pending) {
      pendingWithdrawMethodRef.current = null
      proceedWithWithdrawMethod(pending, status?.fullName ?? kycFullName)
    }
  }

  function handleKycClose() {
    pendingWithdrawMethodRef.current = null
    onKycClose()
  }

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      setTab('deposit'); setDepositView('select'); setSelectedMethod(null); setAmount(''); setHistoryFilter('all'); setHistoryStatus('all'); setDepositCategory('ewallet')
      void loadPromoConfig()
      setDepositLoading(false); setDepositMessage(''); setDepositSuccess(false)
      setWithdrawAccount(''); setWithdrawOwner(''); setWithdrawMessage(''); setWithdrawSuccess(false)
      pendingWithdrawMethodRef.current = null
      setTurnoverProgress(null); setTurnoverLoading(false)
      setTonLoading(false); setTonMessage(''); setTonSuccess(false)
      setHasSuccessfulDeposit(null)
      void walletStore.refresh()
      void loadFirstDepDepositState()
      void fetchPaymentChannels('deposit').then(setPaymentDepositChannels).catch(()=>{})
      void fetchPaymentChannels('withdraw').then(setPaymentWithdrawChannels).catch(()=>{})
      void fetchCryptoChannels().then((list)=>setCryptoEnabled(Object.fromEntries(list.map((c)=>[c.name,c.enabled])))).catch(()=>{})
    } else { stopPolling(); stopTonPolling() }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => { if(tab==='history')void loadHistory() }, [tab])

  useEffect(() => {
    if (tab !== 'withdraw' || !selectedMethod) return
    const allFiltered = [...filteredFiatWithdraw, ...filteredCryptoWithdraw]
    if (!allFiltered.some((m) => m.id === selectedMethod)) {
      setSelectedMethod(null)
      setWithdrawMessage('')
    }
  }, [activeCurrency])

  useEffect(() => {
    if (tab !== 'withdraw') return
    setTurnoverLoading(true)
    fetchTurnoverProgress(activeCurrency)
      .then(setTurnoverProgress)
      .catch(() => setTurnoverProgress(null))
      .finally(() => setTurnoverLoading(false))
  }, [tab, activeCurrency])

  useEffect(() => {
    if (tab !== 'withdraw' || !selectedMethod || !boundPhoneNumber) return
    if (isPhoneWalletWithdraw(selectedMethod)) {
      setWithdrawAccount(walletAccountFromPhone(boundPhoneNumber))
    }
  }, [tab, selectedMethod, boundPhoneNumber])

  useEffect(() => {
    if (tab !== 'withdraw' || !selectedMethod || !kycFullName || withdrawOwner.trim()) return
    if (isPhoneWalletWithdraw(selectedMethod)) {
      setWithdrawOwner(kycFullName)
    }
  }, [tab, selectedMethod, kycFullName, withdrawOwner])

  useEffect(() => {
    if (!selectedMethod) return
    const method = allPayMethods.find((m) => m.id === selectedMethod)
    if (method?.channelId === 'matrix' && tab === 'deposit') {
      setDepositView('select')
      setMatrixAddress(''); setDepositMessage(''); setMatrixAddressLoading(true); setCopiedAddress(false)
      void fetchMatrixDepositAddress(method.matrixSymbol!, method.matrixChain!)
        .then((res) => setMatrixAddress(res.address))
        .catch((e) => setDepositMessage(e instanceof Error ? e.message : t('wallet.matrixDepositFetchFailed')))
        .finally(() => setMatrixAddressLoading(false))
    } else {
      setDepositView('input')
      if (tab === 'deposit') {
        const isCrypto = /^(usdt|ton|btc|eth|bnb|matrix)/.test(selectedMethod) && !selectedMethod.startsWith('tg_wallet')
        if (!isCrypto) setAmount(DEFAULT_DEPOSIT_AMOUNTS[selectedMethod] ?? '')
      }
      setMatrixAddress(''); setMatrixAddressLoading(false); setCopiedAddress(false)
    }
  }, [selectedMethod])

  useEffect(() => { return () => { stopPolling(); stopTonPolling() } }, [])

  const liveFiatDeposit = useMemo((): PayMethod[] => FIAT_DEPOSIT.map((m) => {
    const ch = paymentDepositChannels.find((c) => c.name === m.id)
    if (ch) return { ...m, id: `fiat_${m.id}`, tag: ch.minAmount ? `₱${ch.minAmount}–₱${ch.maxAmount}` : 'Instant', enabled: true, channelId: `fiat_${m.id}`, paymentChannelName: m.id, minAmount: ch.minAmount ?? undefined, maxAmount: ch.maxAmount ?? undefined }
    return { ...m, enabled: false }
  }), [paymentDepositChannels])

  const liveFiatWithdraw = useMemo((): PayMethod[] => FIAT_WITHDRAW.map((m) => {
    const channelName = m.id.replace('-w', '')
    const ch = paymentWithdrawChannels.find((c) => c.name === channelName)
    if (ch) return { ...m, enabled: true, paymentChannelName: channelName }
    return { ...m, enabled: false }
  }), [paymentWithdrawChannels])

  // 虚拟币/TG 渠道开关由后台控制：命中开关 map 时覆盖 enabled
  const applyCrypto = (list: PayMethod[]) => list.map((m) => m.id in cryptoEnabled ? { ...m, enabled: cryptoEnabled[m.id] } : m)
  const liveTgWalletDeposit = useMemo(() => applyCrypto(TG_WALLET_DEPOSIT), [cryptoEnabled])
  const liveCryptoDeposit = useMemo(() => applyCrypto(CRYPTO_DEPOSIT), [cryptoEnabled])
  const liveCryptoWithdraw = useMemo(() => applyCrypto(CRYPTO_WITHDRAW), [cryptoEnabled])

  const allPayMethods = useMemo(() => [...liveTgWalletDeposit, ...liveFiatDeposit, ...liveCryptoDeposit, ...liveFiatWithdraw, ...liveCryptoWithdraw], [liveTgWalletDeposit, liveFiatDeposit, liveCryptoDeposit, liveFiatWithdraw, liveCryptoWithdraw])
  const selectedPayMethod = useMemo(() => allPayMethods.find((m)=>m.id===selectedMethod), [allPayMethods, selectedMethod])
  const isTgWallet = selectedMethod?.startsWith('tg_wallet') ?? false
  const isUnifiedFiat = (selectedMethod ?? '').startsWith('fiat_')
  const isTonConnect = selectedPayMethod?.channelId === 'ton_connect'
  const isMatrixDeposit = selectedPayMethod?.channelId === 'matrix' && tab === 'deposit'
  const filteredFiatWithdraw = useMemo(
    () => liveFiatWithdraw.filter((m) => !m.currency || m.currency === activeCurrency),
    [liveFiatWithdraw, activeCurrency],
  )
  const filteredCryptoWithdraw = useMemo(
    () => liveCryptoWithdraw.filter((m) => !m.currency || m.currency === activeCurrency),
    [liveCryptoWithdraw, activeCurrency],
  )
  const isFiatWithdraw = liveFiatWithdraw.some((m) => m.id === selectedMethod)
  const withdrawAccountLocked = isPhoneWalletWithdraw(selectedMethod) && Boolean(boundPhoneNumber)
  const isMatrixWithdraw = selectedPayMethod?.channelId === 'matrix' && tab === 'withdraw'
  const isCryptoMethod = /usdt|ton|btc|eth|bnb/.test(selectedMethod ?? '') && !isTgWallet
  const depositCurrency = selectedPayMethod?.currency ?? 'PHP'
  const depositCategoryMethods = useMemo((): Record<DepositCategory, PayMethod[]> => ({
    ewallet: liveFiatDeposit, crypto: liveCryptoDeposit, telegram: liveTgWalletDeposit,
  }), [liveFiatDeposit, liveCryptoDeposit, liveTgWalletDeposit])
  const currentCategoryMethods = depositCategoryMethods[depositCategory]
  const firstDepEligible = isLoggedIn && !firstDepClaimed && hasSuccessfulDeposit === false && (promoConfig?.firstdep.enabled ?? false)
  const depositPresets = DEPOSIT_PRESETS[depositCurrency] ?? DEPOSIT_PRESETS.PHP
  const depositTierList = promoConfig?.firstdep.tiers?.[depositCurrency]

  // 充值：切换分类（或渠道加载完成）时自动选中该分类首个可用、非地址型渠道
  useEffect(() => {
    if (!open || tab !== 'deposit') return
    const firstEnabled = currentCategoryMethods.find((m) => m.enabled !== false && m.channelId !== 'matrix')
    setSelectedMethod(firstEnabled?.id ?? null)
    setAmount(''); setDepositMessage('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositCategory, open, tab, currentCategoryMethods])
  const tonAddressShort = useMemo(() => { const addr=tonWalletAddress; if(!addr)return ''; return addr.length>20?`${addr.slice(0,10)}…${addr.slice(-6)}`:addr }, [tonWalletAddress])
  const canSubmitDeposit = Boolean(!depositLoading && selectedPayMethod?.channelId && Number(amount) > 0)
  const canSubmitWithdraw = Boolean(!withdrawLoading && isFiatWithdraw && Number(amount) > 0 && withdrawAccount.trim() && withdrawOwner.trim())
  const canSubmitMatrixWithdraw = Boolean(!withdrawLoading && isMatrixWithdraw && Number(matrixCryptoAmount) > 0 && withdrawAccount.trim())
  const filteredHistory = useMemo(() => historyOrders.filter((tx) => (historyFilter==='all'||tx.type===historyFilter) && (historyStatus==='all'||tx.status===historyStatus)), [historyOrders, historyFilter, historyStatus])

  const walletTabs = useMemo(() => [{ id:'deposit' as const, label:t('wallet.deposit'), Icon:ArrowDownToLine }, { id:'withdraw' as const, label:t('wallet.withdraw'), Icon:ArrowUpFromLine }, { id:'history' as const, label:t('wallet.history'), Icon:History }], [t])
  const depositCategoryTabs = useMemo(() => [
    { id:'ewallet' as const, label:t('wallet.catEwallet'), Icon:Wallet },
    { id:'crypto' as const, label:t('wallet.catCrypto'), Icon:Zap },
    { id:'telegram' as const, label:t('wallet.catTelegram'), Icon:Send },
  ], [t])

  function addPresetAmount(amt: number) {
    const current = Number(amount)
    const next = (Number.isFinite(current) ? current : 0) + amt
    setAmount(String(Math.round(next * 1000000) / 1000000))
  }

  const pollFiatDepositCountRef = useRef(0)
  async function pollFiatDeposit() {
    if(!pollSerial)return; pollFiatDepositCountRef.current++; if(pollFiatDepositCountRef.current>60){stopPolling();setDepositLoading(false);setDepositMessage(t('wallet.yfpayDepositTimeout'));return}
    try { const res=await queryPaymentDeposit(pollSerial); if(res.state===2){stopPolling();setDepositLoading(false);setDepositSuccess(true);setDepositMessage(t('wallet.yfpayDepositSuccess'));await walletStore.refresh()}else if(res.state===3){stopPolling();setDepositLoading(false);setDepositMessage(t('wallet.yfpayDepositRejected'))} } catch { /* keep polling */ }
  }

  async function onProceedUnifiedFiatDeposit() {
    const method=selectedPayMethod; if(!method?.paymentChannelName)return; const num=Number(amount)
    if(!Number.isFinite(num)||num<=0){setDepositMessage(t('wallet.invalidAmount'));return}
    if(method.minAmount&&num<method.minAmount){setDepositMessage(t('wallet.yfpayAmountOutOfRange',{min:method.minAmount,max:method.maxAmount}));return}
    if(method.maxAmount&&num>method.maxAmount){setDepositMessage(t('wallet.yfpayAmountOutOfRange',{min:method.minAmount,max:method.maxAmount}));return}
    setDepositLoading(true); setDepositMessage(t('wallet.yfpayOpenBrowser')); setDepositSuccess(false); stopPolling(); pollFiatDepositCountRef.current=0
    try {
      const result=await createPaymentDeposit({channelName:method.paymentChannelName,amount:num}); setPollSerial(result.merchantSerial)
      if(window.Telegram?.WebApp?.openLink)window.Telegram.WebApp.openLink(result.payUrl); else window.open(result.payUrl,'_blank')
      setDepositMessage(t('wallet.yfpayWaitingPayment')); pollTimerRef.current=setInterval(()=>void pollFiatDeposit(),3000)
    } catch(e){setDepositLoading(false);setDepositMessage(e instanceof ApiError?e.message:t('wallet.yfpayDepositFailed'))}
  }

  async function onProceedDeposit() {
    const method=selectedPayMethod; if(!method?.channelId||method.currency==null)return; const num=Number(amount)
    if(!Number.isFinite(num)||num<=0){setDepositMessage(t('wallet.invalidAmount'));return}
    setDepositLoading(true); setDepositMessage(''); setDepositSuccess(false)
    try {
      const result=await createDeposit(num,method.currency)
      if(result.status==='paid'){await walletStore.refresh();setDepositSuccess(true);setDepositMessage(t('wallet.credited'));return}
      if(result.invoiceLink){
        if(!isTelegramWebApp()){setDepositMessage(t('wallet.openInTelegram'));return}
        const closeStatus=await openTelegramInvoice(result.invoiceLink)
        if(closeStatus==='paid'){const credited=await waitForDepositPaid(result.orderId);if(credited){await walletStore.refresh();setDepositSuccess(true);setDepositMessage(t('wallet.paymentSuccess'))}else setDepositMessage(t('wallet.paymentPending'))}
        else if(closeStatus==='cancelled')setDepositMessage(t('wallet.paymentCancelled'))
        else if(closeStatus==='failed')setDepositMessage(t('wallet.paymentFailed'))
        else setDepositMessage(t('wallet.completeInTelegram')); return
      }
      setDepositMessage(t('wallet.unavailable'))
    } catch(e){setDepositMessage(e instanceof ApiError?e.message:t('wallet.depositFailed'))} finally{setDepositLoading(false)}
  }

  async function onProceedTonDeposit() {
    const amountTon=Number(amount); if(!amountTon||amountTon<0.01){setTonMessage(t('wallet.invalidAmount'));return}
    setTonLoading(true); tonLoadingRef.current=true; setTonMessage(''); setTonSuccess(false); stopTonPolling()
    try {
      let address=tonWalletAddress
      if(!tonIsConnected){setTonMessage(t('wallet.tonConnecting'));address=await connectTonWallet()}
      if(!address){setTonMessage(t('wallet.paymentCancelled'));return}
      setTonMessage(t('wallet.tonCreatingOrder')); const order=await createTonDeposit(amountTon,address)
      if(order.devSettled){setTonSuccess(true);setTonMessage(t('wallet.tonSuccess'));await walletStore.refresh();return}
      setTonMessage(t('wallet.tonSending')); await sendTonTransaction(order.merchantAddress,order.amountNano)
      setTonMessage(t('wallet.tonPolling')); let tonPollCount=0
      tonPollTimerRef.current=setInterval(async()=>{
        tonPollCount++; if(tonPollCount>60){stopTonPolling();setTonLoading(false);setTonMessage(t('wallet.tonTimeout'));return}
        try{const status=await pollTonDepositStatus(order.orderId);if(status.status==='paid'){stopTonPolling();setTonLoading(false);setTonSuccess(true);setTonMessage(t('wallet.tonSuccess'));await walletStore.refresh()}else if(status.status==='failed'||status.status==='cancelled'){stopTonPolling();setTonLoading(false);setTonMessage(t('wallet.depositFailed'))}}catch{/***/}
      },5000)
    } catch(e){stopTonPolling();const msg=(e as Error)?.message??'';if(msg.includes('cancel')||msg.includes('reject')||msg==='wallet_connect_timeout')setTonMessage(t('wallet.paymentCancelled'));else setTonMessage(e instanceof ApiError?e.message:t('wallet.depositFailed'));setTonLoading(false)}
    finally{if(!tonPollTimerRef.current){tonLoadingRef.current=false}}
  }

  async function onProceedWithdraw() {
    if(!canSubmitWithdraw)return; const n=Number(amount)
    setWithdrawLoading(true); setWithdrawMessage(''); setWithdrawSuccess(false)
    const channelName=selectedPayMethod?.paymentChannelName; if(!channelName)return
    try{await createPaymentWithdrawal({channelName,amount:n,targetOwner:withdrawOwner.trim(),targetAccount:withdrawAccount.trim()});setWithdrawSuccess(true);setWithdrawMessage(t('wallet.yfpayWithdrawPending'));await walletStore.refresh();setTimeout(()=>{setTab('history');setHistoryFilter('withdraw');void loadHistory()},1500)}catch(e){setWithdrawMessage(e instanceof ApiError?e.message:t('wallet.yfpayWithdrawFailed'))}finally{setWithdrawLoading(false)}
  }

  async function onProceedMatrixWithdraw() {
    if (!canSubmitMatrixWithdraw || !selectedPayMethod) return
    setWithdrawLoading(true); setWithdrawMessage(''); setWithdrawSuccess(false)
    try {
      await createMatrixWithdrawal({
        toAddress: withdrawAccount.trim(),
        symbol: selectedPayMethod.matrixSymbol!,
        chain: selectedPayMethod.matrixChain!,
        cryptoAmount: matrixCryptoAmount.trim(),
      })
      setWithdrawSuccess(true); setWithdrawMessage(t('wallet.matrixWithdrawPending'))
      await walletStore.refresh()
      setTimeout(() => { setTab('history'); setHistoryFilter('withdraw'); void loadHistory() }, 1500)
    } catch (e) {
      setWithdrawMessage(e instanceof Error ? e.message : t('wallet.matrixWithdrawFailed'))
    } finally { setWithdrawLoading(false) }
  }

  async function copyMatrixAddress() {
    try { await navigator.clipboard.writeText(matrixAddress); setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000) } catch { /**/ }
  }

  async function loadHistory() {
    setHistoryLoading(true)
    try{
      const[yfDeposits,yfWithdrawals,bgDeposits,bgWithdrawals]=await Promise.all([fetchYfDepositOrders().catch(()=>[]),fetchYfWithdrawOrders().catch(()=>[]),fetchDepositHistory().catch(()=>[]),fetchWithdrawHistory().catch(()=>[])])
      const seen=new Set<string>(); const items: HistoryItem[]=[]
      for(const d of bgDeposits){seen.add(d.orderId);const dAmt=d.currency==='PHP'?`+₱${(d.creditedCents??d.amount).toFixed(2)}`:`+${parseFloat(d.amount.toFixed(6))} ${d.currency}`;items.push({id:d.orderId,orderId:d.orderId,type:'deposit',method:mapDepositChannelName(d.channelId),amount:dAmt,date:formatOrderDate(d.createdAt),sortKey:d.createdAt,status:mapDepositStatus(d.status)})}
      for(const w of bgWithdrawals){seen.add(w.orderId);const wAmt=w.channelId==='matrix'?`-${w.amount} ${w.currency}`:`-₱${w.amount.toFixed(2)}`;items.push({id:w.orderId,orderId:w.orderId,type:'withdraw',method:mapDepositChannelName(w.channelId),amount:wAmt,date:formatOrderDate(w.createdAt),sortKey:w.createdAt,status:mapDepositStatus(w.status)})}
      for(const d of yfDeposits)if(!seen.has(d.merchantSerial))items.push({id:d.merchantSerial,orderId:d.merchantSerial,type:'deposit',method:methodDisplayName(d.channelCode??''),amount:`+₱${d.amount.toFixed(2)}`,date:formatOrderDate(d.createdAt),sortKey:d.createdAt,status:mapDepositState(d.state)})
      for(const w of yfWithdrawals)if(!seen.has(w.merchantSerial))items.push({id:w.merchantSerial,orderId:w.merchantSerial,type:'withdraw',method:methodDisplayName(w.optionCode??''),amount:`-₱${w.amount.toFixed(2)}`,date:formatOrderDate(w.createdAt),sortKey:w.createdAt,status:mapWithdrawState(w.state)})
      items.sort((a,b)=>b.sortKey.localeCompare(a.sortKey)); setHistoryOrders(items)
    }catch{setHistoryOrders([])}finally{setHistoryLoading(false)}
  }

  async function loadFirstDepDepositState() {
    if (!isLoggedIn) { setHasSuccessfulDeposit(null); return }
    try {
      const [bgDeposits, yfDeposits] = await Promise.all([
        fetchDepositHistory().catch(()=>[]),
        fetchYfDepositOrders().catch(()=>[]),
      ])
      setHasSuccessfulDeposit(bgDeposits.some((d) => d.status === 'paid' || d.status === 'completed') || yfDeposits.some((d) => d.state === 2))
    } catch { setHasSuccessfulDeposit(null) }
  }

  async function copyOrderId(id: string) { try{await navigator.clipboard.writeText(id);setCopiedId(id);setTimeout(()=>setCopiedId(null),2000)}catch{/***/} }

  function resetToSelect() { pendingWithdrawMethodRef.current = null; setDepositView('select'); setSelectedMethod(null); setAmount(''); setDepositMessage(''); setWithdrawMessage(''); setWithdrawAccount(''); setWithdrawOwner(''); stopPolling(); setDepositLoading(false); setPollSerial(''); setDepositSuccess(false); stopTonPolling(); setTonMessage(''); setTonLoading(false); setTonSuccess(false); setMatrixAddress(''); setMatrixCryptoAmount(''); setCopiedAddress(false) }

  if (!open) return null

  return createPortal(
    <>
      <div ref={backdropRef} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-3xl bg-card"
        style={{ height: '86vh', maxHeight: '86vh', transform: 'translateX(-50%)' }}
        onPointerDown={(e) => onPointerDown(e.nativeEvent)}
        onPointerUp={(e) => onPointerUp(e.nativeEvent)}
        onPointerCancel={(e) => onPointerCancel(e.nativeEvent)}
      >
        <div className="flex flex-shrink-0 justify-center pb-1 pt-3"><div className="h-1 w-10 rounded-full bg-border" /></div>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2"><Wallet size={18} className="text-primary" /><span className="font-display text-base font-black text-foreground">{t('wallet.title')}</span></div>
          <span className="text-sm font-black tabular-nums text-primary">{displayActive}</span>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary transition-colors hover:bg-muted" onClick={onClose}><X size={15} className="text-muted-foreground" /></button>
        </div>

        <div className="flex flex-shrink-0 gap-2 px-5 pt-3">
          {walletTabs.map(({id, label, Icon}) => (
            <button key={id} type="button" className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-colors ${tab===id?'bg-primary text-primary-foreground shadow shadow-amber-500/20':'bg-secondary text-muted-foreground hover:text-foreground'}`}
              onClick={() => { setTab(id); setDepositView('select'); setSelectedMethod(null); setAmount(''); setDepositMessage(''); setWithdrawMessage('') }}
            ><Icon size={14} />{label}</button>
          ))}
        </div>

        {tab === 'history' && (
          <div className="px-5 pt-3 space-y-2 flex-shrink-0">
            <div className="flex gap-1.5">
              {(['all','deposit','withdraw'] as const).map((f) => (
                <button key={f} type="button" className={`px-3 py-1 rounded-lg text-[11px] font-black capitalize transition-colors border ${historyFilter===f?f==='deposit'?'bg-emerald-500/20 text-emerald-400 border-emerald-500/40':f==='withdraw'?'bg-red-500/20 text-red-400 border-red-500/40':'bg-primary/20 text-primary border-primary/40':'bg-secondary text-muted-foreground border-transparent'}`} onClick={() => setHistoryFilter(f)}>
                  {f==='deposit'?t('wallet.filterDeposit'):f==='withdraw'?t('wallet.filterWithdraw'):t('wallet.filterAll')}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['all','success','pending','rejected','admin_rejected','failed'] as const).map((s) => (
                <button key={s} type="button" className={`px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors ${historyStatus===s?s==='success'?'bg-emerald-500 text-white':s==='pending'?'bg-yellow-500 text-black':s==='rejected'?'bg-orange-500 text-white':s==='admin_rejected'?'bg-rose-700 text-white':s==='failed'?'bg-red-500 text-white':'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`} onClick={() => setHistoryStatus(s)}>
                  {t(`common.${s}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div data-sheet-scroll className="page-scroll flex-1 px-5 pb-4 pt-4 hide-scrollbar overflow-y-auto">
          {tab !== 'history' ? (
            <>
              {tab === 'deposit' ? (
                <div className="space-y-4">
                  {/* 充值分类 tab：电子钱包 / 虚拟币 / Telegram */}
                  <div className="flex gap-2">
                    {depositCategoryTabs.map(({id, label, Icon})=>(
                      <button key={id} type="button" onClick={()=>setDepositCategory(id)} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-colors ${depositCategory===id?'bg-primary text-primary-foreground shadow shadow-amber-500/20':'bg-secondary text-muted-foreground hover:text-foreground'}`}><Icon size={14} />{label}</button>
                    ))}
                  </div>
                  {/* 渠道 chips */}
                  <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1">
                    {currentCategoryMethods.length===0 ? <p className="text-xs text-muted-foreground py-3">{t('wallet.comingSoon')}</p> : currentCategoryMethods.map((m)=>{
                      const disabled=m.enabled===false; const sel=selectedMethod===m.id
                      return (
                        <button key={m.id} type="button" disabled={disabled} onClick={()=>{setSelectedMethod(m.id);setAmount('');setDepositMessage('')}}
                          className={`flex-shrink-0 w-[100px] rounded-xl border p-2.5 flex flex-col items-center gap-1.5 transition-colors ${sel?'border-primary bg-primary/10':'border-border bg-secondary'} ${disabled?'opacity-40':''}`}>
                          {m.iconUrl ? <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0"><img src={m.iconUrl} alt={m.name} className="w-full h-full object-contain" /></div>
                            : <div className={`w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 ${m.color}`}>{m.iconKind==='telegram'?<Send size={14} className="text-white" strokeWidth={2.5}/>:<span className="text-white text-xs font-black">{m.icon}</span>}</div>}
                          <span className="text-[11px] font-bold text-foreground truncate w-full text-center">{m.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  {selectedPayMethod ? (
                    isMatrixDeposit ? (
                      <div className="space-y-4">
                        <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{t('wallet.matrixDepositTitle')}</p>
                        {matrixAddressLoading ? (
                          <div className="flex flex-col items-center gap-3 py-8"><Loader2 size={28} className="text-primary animate-spin opacity-70" /></div>
                        ) : matrixAddress ? (
                          <>
                            <p className="text-xs text-muted-foreground text-center">{t('wallet.matrixDepositNote', { symbol: selectedPayMethod.matrixSymbol, chain: selectedPayMethod.matrixChain })}</p>
                            <div className="flex justify-center">
                              <div className="bg-white rounded-2xl p-3 shadow-lg shadow-black/20">
                                <QRCodeSVG value={matrixAddress} size={180} bgColor="#ffffff" fgColor="#111111" level="M" />
                              </div>
                            </div>
                            <div className="bg-secondary rounded-2xl px-4 py-3 space-y-2.5">
                              <p className="font-mono text-sm font-bold text-foreground break-all leading-relaxed tracking-wide text-center">{matrixAddress}</p>
                              <button type="button" className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-colors w-full justify-center ${copiedAddress?'bg-emerald-500/20 text-emerald-400':'bg-primary/10 text-primary hover:bg-primary/20'}`} onClick={()=>void copyMatrixAddress()}>
                                {copiedAddress?<Check size={13}/>:<Copy size={13}/>}{copiedAddress?t('common.copied'):t('common.copy')}
                              </button>
                            </div>
                            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                              <ShieldCheck size={13} className="text-amber-400 flex-shrink-0" />
                              <span className="text-[11px] text-amber-300/80">{`Network: ${selectedPayMethod.matrixChain} · Min 1 ${selectedPayMethod.matrixSymbol}`}</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-amber-400 text-center py-4">{depositMessage}</p>
                        )}
                      </div>
                    ) : (
                    <>
                      <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{t('wallet.depositAmount')}</p>
                      {/* 金额档位网格（带首存奖励角标） */}
                      <div className="grid grid-cols-3 gap-2">
                        {depositPresets.map((amt)=>{
                          const sel=amount===String(amt); const bonus=firstDepEligible?matchTierBonus(depositTierList,amt):0
                          return (
                            <button key={amt} type="button" onClick={()=>addPresetAmount(amt)} className={`rounded-xl border py-2 px-1 flex flex-col items-center transition-colors ${sel?'border-primary bg-primary/10':'border-border bg-secondary'}`}>
                              <span className="text-sm font-black text-foreground">+{fmtPreset(amt,depositCurrency)}</span>
                              {bonus>0 && <span className="text-[10px] font-bold text-primary mt-0.5 leading-none">{t('wallet.firstDepBonusBadge',{amount:fmtPreset(bonus,depositCurrency)})}</span>}
                            </button>
                          )
                        })}
                      </div>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">{isTonConnect?'TON':depositCurrency==='USDT'||depositCurrency==='USDC'?'$':isCryptoMethod?'≈ $':'₱'}</span>
                        <input value={amount} type="number" placeholder="0.00" className={`w-full bg-secondary border border-border rounded-xl pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary ${isTonConnect?'pl-14':'pl-10'}`} onChange={(e)=>setAmount(e.target.value)} />
                      </div>
                      {firstDepEligible&&Number(amount)>0&&matchTierBonus(depositTierList,Number(amount))>0&&<p className="text-[11px] font-bold text-primary text-center -mt-1">{t('wallet.firstDepBonusHint',{amount:fmtPreset(matchTierBonus(depositTierList,Number(amount)),depositCurrency)})}</p>}
                      {isTonConnect&&amount&&Number(amount)>0&&<p className="text-xs text-muted-foreground text-center -mt-1">≈ ₱{(Number(amount)*350).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>}
                      {depositMessage&&<p className={`text-xs font-bold text-center ${depositSuccess?'text-emerald-400':'text-amber-400'}`}>{depositMessage}</p>}
                      {isTonConnect&&<>
                        {tonIsConnected&&<div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2"><div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" /><span className="text-xs font-bold text-muted-foreground flex-1 truncate font-mono">{tonAddressShort}</span><button type="button" className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={()=>void disconnectTon()}>{t('wallet.tonDisconnect')}</button></div>}
                        {tonMessage&&<p className={`text-xs font-bold text-center ${tonSuccess?'text-emerald-400':'text-amber-400'}`}>{tonMessage}</p>}
                        <button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-sky-500 text-white hover:bg-sky-400 shadow-sky-500/20" disabled={tonLoading||!amount||Number(amount)<0.01} onClick={()=>void onProceedTonDeposit()}>{tonLoading?<Loader2 size={18} className="animate-spin"/>:<span className="font-black text-xs leading-none">TON</span>}{tonLoading?t('wallet.tonLoading'):tonIsConnected?t('wallet.tonPay'):t('wallet.tonConnect')}</button>
                      </>}
                      {isTgWallet&&<button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20" disabled={!canSubmitDeposit} onClick={()=>void onProceedDeposit()}>{depositLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowDownToLine size={18} />}{depositLoading?t('wallet.openingPay'):t('wallet.payTelegram')}</button>}
                      {isUnifiedFiat&&!isTonConnect&&<button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20" disabled={!canSubmitDeposit||depositLoading} onClick={()=>void onProceedUnifiedFiatDeposit()}>{depositLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowDownToLine size={18} />}{depositLoading?t('wallet.yfpayWaitingPayment'):t('wallet.yfpayProceedDeposit')}</button>}
                    </>
                    )
                  ) : <p className="text-center text-sm text-muted-foreground py-8">{t('wallet.comingSoon')}</p>}
                </div>
              ) : depositView === 'select' ? (
                <div className="space-y-5">
                      {turnoverLoading ? (
                        <div className="h-11 bg-secondary rounded-xl animate-pulse" />
                      ) : turnoverProgress ? (
                        turnoverProgress.canWithdraw ? (
                          // 只在确实有流水记录时才显示"已完成"提示，新用户从未存款则不展示
                          turnoverProgress.requirements.length > 0 ? (
                            <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2">
                              <CheckCircle2 size={13} className="text-emerald-400/60 flex-shrink-0" />
                              <span className="text-xs text-muted-foreground">{t('wallet.turnoverAllClear')}</span>
                            </div>
                          ) : null
                        ) : (
                          <div className={`bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 space-y-2.5${turnoverShake?' turnover-shake':''}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Lock size={13} className="text-amber-400 flex-shrink-0" />
                                <span className="text-[11px] font-bold text-amber-300">{t('wallet.turnoverBlocked')}</span>
                              </div>
                              <span className="text-xs font-black text-amber-400">{(() => {
                                const byCurr: Record<string,number> = {}
                                for (const r of turnoverProgress.requirements.filter(x=>x.status==='pending')) byCurr[r.currency]=(byCurr[r.currency]??0)+(r.requiredAmount-r.completedAmount)
                                return Object.entries(byCurr).map(([c,v])=>fmtTurnoverAmount(v,c)).join(' + ')
                              })()}</span>
                            </div>
                            {turnoverProgress.requirements.filter(r=>r.status==='pending').slice(0,3).map(req=>{
                              const pct=Math.min(100,(req.completedAmount/req.requiredAmount)*100)
                              return (
                                <div key={req.id} className="space-y-1">
                                  <div className="flex justify-between">
                                    <span className="text-[10px] text-amber-300/70">{req.sourceType==='deposit'?t('wallet.turnoverDeposit'):req.sourceRef==='trial'?t('wallet.promoTrial'):req.sourceRef==='referral'?t('wallet.promoReferral'):req.sourceRef==='firstdep'?t('wallet.promoFirstdep'):t('wallet.turnoverPromo')} · {fmtTurnoverAmount(req.requiredAmount,req.currency??'PHP')}</span>
                                    <span className="text-[10px] font-bold text-amber-300/70">{Math.round(pct)}%</span>
                                  </div>
                                  <div className="h-1 bg-amber-500/20 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-400 rounded-full" style={{width:`${pct}%`}} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      ) : null}
                      {filteredFiatWithdraw.length > 0 && <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.fiatSection')}</p><PayMethodGrid methods={filteredFiatWithdraw} selected={selectedMethod} onSelect={onSelectWithdrawMethod} /></div>}
                      {filteredCryptoWithdraw.length > 0 && <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.cryptoSection')}</p><PayMethodGrid methods={filteredCryptoWithdraw} selected={selectedMethod} onSelect={onSelectWithdrawMethod} /></div>}
                  {filteredFiatWithdraw.length === 0 && filteredCryptoWithdraw.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">{t('wallet.noWithdrawMethodsForCurrency', { currency: activeCurrency })}</p>}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary hover:bg-muted transition-colors flex-shrink-0" onClick={resetToSelect}><ArrowLeft size={16} className="text-foreground" /></button>
                    <div className="flex items-center gap-2.5 flex-1 bg-secondary rounded-xl px-3 py-2.5">
                      {selectedPayMethod?.iconUrl ? <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"><img src={selectedPayMethod.iconUrl} alt={selectedPayMethod.name} className="w-full h-full object-cover" /></div>
                        : <div className={`w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 ${selectedPayMethod?.color??'from-muted to-muted'}`}>{selectedPayMethod?.iconKind==='telegram'?<Send size={16} className="text-white" strokeWidth={2.5}/>:<span className="text-white font-black text-sm">{selectedPayMethod?.icon}</span>}</div>}
                      <div className="flex-1"><span className="text-foreground font-black text-sm">{selectedPayMethod?.name}</span></div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">{selectedPayMethod?.tag}</span>
                    </div>
                  </div>
                  {!isMatrixWithdraw&&<p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{t('wallet.withdrawAmount')}</p>}
                  {!isMatrixWithdraw&&<div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">{isTonConnect?'TON':isTgWallet&&depositCurrency==='USDT'?'$':isCryptoMethod?'≈ $':'₱'}</span>
                    <input value={amount} type="number" placeholder="0.00" className={`w-full bg-secondary border border-border rounded-xl pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary ${isTonConnect?'pl-14':'pl-10'}`} onChange={(e)=>setAmount(e.target.value)} />
                  </div>}
                  {tab==='withdraw'&&isFiatWithdraw&&<>
                    <input value={withdrawAccount} type="tel" readOnly={withdrawAccountLocked} placeholder={t('wallet.yfpayAccountNumber')} className={`w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary${withdrawAccountLocked ? ' opacity-60' : ''}`} onChange={withdrawAccountLocked ? undefined : (e)=>setWithdrawAccount(e.target.value)} />
                    {withdrawAccountLocked && <p className="text-[10px] text-muted-foreground">{t('kyc.phoneLocked')}</p>}
                    <input value={withdrawOwner} type="text" placeholder={t('wallet.yfpayFullName')} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setWithdrawOwner(e.target.value)} />
                  </>}
                  {withdrawMessage&&!isMatrixWithdraw&&<p className={`text-xs font-bold text-center ${withdrawSuccess?'text-emerald-400':'text-amber-400'}`}>{withdrawMessage}</p>}
                  {tab==='withdraw'&&isMatrixWithdraw&&<>
                    <input value={matrixCryptoAmount} type="number" placeholder={t('wallet.matrixCryptoAmount', { symbol: selectedPayMethod?.matrixSymbol ?? 'TRX' })} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setMatrixCryptoAmount(e.target.value)} />
                    <input value={withdrawAccount} type="text" placeholder={t('wallet.matrixWithdrawAddress', { symbol: selectedPayMethod?.matrixSymbol ?? 'TRX' })} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary font-mono" onChange={(e)=>setWithdrawAccount(e.target.value)} />
                    {withdrawMessage&&<p className={`text-xs font-bold text-center ${withdrawSuccess?'text-emerald-400':'text-amber-400'}`}>{withdrawMessage}</p>}
                    <button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-red-600 text-white hover:bg-red-500 shadow-red-500/20" disabled={!canSubmitMatrixWithdraw} onClick={()=>void onProceedMatrixWithdraw()}>{withdrawLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowUpFromLine size={18} />}{withdrawLoading?t('wallet.openingPay'):t('wallet.matrixWithdrawSubmit')}</button>
                  </>}
                  {tab==='withdraw'&&isFiatWithdraw&&<button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-accent text-accent-foreground hover:bg-red-500 shadow-red-500/20" disabled={!canSubmitWithdraw} onClick={()=>void onProceedWithdraw()}>{withdrawLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowUpFromLine size={18} />}{withdrawLoading?t('wallet.openingPay'):t('wallet.yfpayWithdrawSubmit')}</button>}
                  {tab==='withdraw'&&!isFiatWithdraw&&!isMatrixWithdraw&&<div className="flex flex-col items-center gap-3 py-6 text-center"><div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center"><span className="text-2xl">🔜</span></div><p className="text-sm font-black text-foreground">{t('wallet.comingSoon')}</p><p className="text-xs text-muted-foreground">{t('wallet.cryptoWithdrawSoon')}</p></div>}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {historyLoading?<div className="py-12 flex flex-col items-center gap-2 text-muted-foreground"><Loader2 size={28} className="opacity-50 animate-spin" /></div>
                : filteredHistory.length===0?<div className="py-12 flex flex-col items-center gap-2 text-muted-foreground"><History size={32} className="opacity-30" /><span className="text-sm">{t('common.noRecords')}</span></div>
                : filteredHistory.map((tx) => {
                  const StatusIcon=statusIconComp(tx.status)
                  return (
                    <div key={tx.id} className="bg-secondary rounded-2xl px-4 py-3 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tx.type==='deposit'?'bg-emerald-500/15':'bg-red-500/15'}`}>{tx.type==='deposit'?<ArrowDownToLine size={16} className="text-emerald-400"/>:<ArrowUpFromLine size={16} className="text-red-400"/>}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between"><span className="text-foreground font-bold text-sm">{tx.method}</span><span className={`font-black text-sm ${tx.type==='deposit'?'text-emerald-400':'text-red-400'}`}>{tx.amount}</span></div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-muted-foreground text-xs">{tx.date}</span>
                            <span className="flex items-center gap-1">
                              <StatusIcon size={14} className={tx.status==='success'?'text-emerald-400':tx.status==='pending'?'text-yellow-400 animate-spin':tx.status==='rejected'?'text-orange-400':tx.status==='admin_rejected'?'text-rose-400':'text-red-400'} />
                              <span className={`text-[11px] font-bold capitalize ${tx.status==='success'?'text-emerald-400':tx.status==='pending'?'text-yellow-400':tx.status==='rejected'?'text-orange-400':tx.status==='admin_rejected'?'text-rose-400':'text-red-400'}`}>{t(`common.${tx.status}`)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pl-12 gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground truncate">{tx.orderId}</span>
                        <button type="button" className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg transition-colors ${copiedId===tx.id?'text-emerald-400 bg-emerald-500/10':'text-muted-foreground hover:text-foreground bg-muted/50'}`} onClick={()=>void copyOrderId(tx.id)}>
                          {copiedId===tx.id?<Check size={10}/>:<Copy size={10}/>}{copiedId===tx.id?t('common.copied'):t('common.copy')}
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {tab !== 'history' && depositView === 'input' && tab === 'deposit' && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-border/50">
            <div className="flex items-center justify-around">
              <div className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-amber-400 flex-shrink-0" /><span className="text-[10px] font-bold text-muted-foreground">{t('wallet.trustSsl')}</span></div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5"><Zap size={12} className="text-emerald-400 flex-shrink-0" /><span className="text-[10px] font-bold text-muted-foreground">{t('wallet.trustInstant')}</span></div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5"><Headphones size={12} className="text-sky-400 flex-shrink-0" /><span className="text-[10px] font-bold text-muted-foreground">{t('wallet.trustSupport')}</span></div>
            </div>
          </div>
        )}
      </div>
      <KycModal open={kycOpen} onClose={handleKycClose} onApproved={handleKycApproved} />
    </>,
    document.body,
  )
}
