import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Wallet, X, ArrowDownToLine, ArrowUpFromLine, History, CheckCircle2, AlertCircle, XCircle, Loader2, ArrowLeft, Send, ShieldCheck, Zap, Headphones, Copy, Check } from 'lucide-react'
import { createPortal } from 'react-dom'
import PayMethodGrid from '@/components/wallet/PayMethodGrid'
import { createDeposit } from '@/api/deposit'
import { createTonDeposit, pollTonDepositStatus } from '@/api/tonDeposit'
import { ApiError, isTelegramWebApp } from '@/api/client'
import { useWalletStore } from '@/stores/wallet'
import { useTonConnect } from '@/hooks/useTonConnect'
import { openTelegramInvoice, waitForDepositPaid } from '@/utils/tgInvoice'
import { fetchYfPayChannels, createYfDeposit, queryYfDeposit, fetchYfDepositOrders, fetchYfWithdrawOrders, fetchDepositHistory, fetchWithdrawHistory, createYfWithdrawal, type YfPayChannel } from '@/api/yfpay'
import { fetchMatrixDepositAddress, createMatrixWithdrawal } from '@/api/matrix'
import { CRYPTO_DEPOSIT, CRYPTO_WITHDRAW, FIAT_DEPOSIT, FIAT_WITHDRAW, TG_WALLET_DEPOSIT, WALLET_BANNERS, type PayMethod } from '@/data/wallet'
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag'

interface Props { open: boolean; onClose: () => void }

interface HistoryItem { id: string; orderId: string; type: 'deposit'|'withdraw'; method: string; amount: string; date: string; sortKey: string; status: 'success'|'pending'|'rejected'|'admin_rejected'|'failed' }

function methodDisplayName(code: string) { const m: Record<string,string>={GCASH:'GCash',GCash:'GCash',gcash:'GCash',MAYA:'Maya',Maya:'Maya',maya:'Maya',BDO:'BDO Bank',BPI:'BPI Bank'}; return m[code]??code??'—' }
function formatOrderDate(iso: string) { try { return new Date(iso).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) } catch { return iso } }
function mapDepositState(state: number): HistoryItem['status'] { if(state===2)return 'success'; if(state===3)return 'rejected'; return 'pending' }
function mapWithdrawState(state: number): HistoryItem['status'] { if(state===1)return 'success'; if(state===2||state===3)return 'rejected'; return 'pending' }
function mapDepositStatus(status: string): HistoryItem['status'] { if(status==='paid'||status==='completed')return 'success'; if(status==='rejected')return 'rejected'; if(status==='admin_rejected')return 'admin_rejected'; if(status==='cancelled'||status==='failed')return 'failed'; return 'pending' }
function mapDepositChannelName(channelId: string) { const m: Record<string,string>={admin:'Admin',tg_wallet:'Telegram',ammer_pay:'Telegram',ton_connect:'TON',yfpay_gcash:'GCash',yfpay_maya:'Maya',yfpay_bdo:'BDO Bank',yfpay_bpi:'BPI Bank',yfpay_unknown:'YF Pay',matrix:'Matrix TRX'}; return m[channelId]??channelId??'—' }
const DEFAULT_DEPOSIT_AMOUNTS: Record<string,string>={tg_wallet_php:'1000',tg_wallet_usdt:'20',yfpay_gcash:'500',yfpay_maya:'500'}
const quickAmountsPhp=['100','500','1000','2000','5000']; const quickAmountsUsdt=['10','25','50','100']

function statusIconComp(status: string) { if(status==='success')return CheckCircle2; if(status==='pending')return Loader2; if(status==='rejected')return XCircle; return AlertCircle }

export default function WalletModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const walletStore = useWalletStore()
  const displayPhp = useWalletStore((s) => s.balance?.displayPhp ?? '₱ —')
  const { walletAddress: tonWalletAddress, isConnected: tonIsConnected, connectWallet: connectTonWallet, disconnect: disconnectTon, sendTransaction: sendTonTransaction } = useTonConnect()

  const sheetRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { onPointerDown, onPointerUp, onPointerCancel } = useBottomSheetDrag(open, onClose, sheetRef, backdropRef)

  const [tab, setTab] = useState<'deposit'|'withdraw'|'history'>('deposit')
  const [depositView, setDepositView] = useState<'select'|'input'|'matrix_address'>('select')
  const [selectedMethod, setSelectedMethod] = useState<string|null>(null)
  const [amount, setAmount] = useState('')
  const [historyFilter, setHistoryFilter] = useState<'all'|'deposit'|'withdraw'>('all')
  const [historyStatus, setHistoryStatus] = useState<'all'|'success'|'pending'|'rejected'|'admin_rejected'|'failed'>('all')
  const [bannerIdx, setBannerIdx] = useState(0)
  const walletBannerTrackRef = useRef<HTMLDivElement>(null)
  const bannerDragRef = useRef({startX:0,startY:0,startScroll:0,axis:null as 'x'|'y'|null,lastX:0,lastT:0})
  const [depositLoading, setDepositLoading] = useState(false)
  const [depositMessage, setDepositMessage] = useState('')
  const [depositSuccess, setDepositSuccess] = useState(false)
  const [yfpayChannels, setYfpayChannels] = useState<YfPayChannel[]>([])
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
  const [historyOrders, setHistoryOrders] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [matrixAddress, setMatrixAddress] = useState('')
  const [matrixAddressLoading, setMatrixAddressLoading] = useState(false)
  const [matrixCryptoAmount, setMatrixCryptoAmount] = useState('')
  const [copiedAddress, setCopiedAddress] = useState(false)

  function stopPolling() { if(pollTimerRef.current){clearInterval(pollTimerRef.current);pollTimerRef.current=null} }
  function stopTonPolling() { if(tonPollTimerRef.current){clearInterval(tonPollTimerRef.current);tonPollTimerRef.current=null} }

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      setTab('deposit'); setDepositView('select'); setSelectedMethod(null); setAmount(''); setHistoryFilter('all'); setHistoryStatus('all'); setBannerIdx(0)
      if(walletBannerTrackRef.current)walletBannerTrackRef.current.scrollLeft=0
      setDepositLoading(false); setDepositMessage(''); setDepositSuccess(false)
      setWithdrawAccount(''); setWithdrawOwner(''); setWithdrawMessage(''); setWithdrawSuccess(false)
      setTonLoading(false); setTonMessage(''); setTonSuccess(false)
      void walletStore.refresh()
      void fetchYfPayChannels().then(setYfpayChannels).catch(()=>{})
    } else { stopPolling(); stopTonPolling() }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => { if(tab==='history')void loadHistory() }, [tab])

  useEffect(() => {
    if (!selectedMethod) return
    const method = allPayMethods.find((m) => m.id === selectedMethod)
    if (method?.channelId === 'matrix' && tab === 'deposit') {
      setDepositView('matrix_address')
      setMatrixAddress(''); setDepositMessage(''); setMatrixAddressLoading(true); setCopiedAddress(false)
      void fetchMatrixDepositAddress(method.matrixSymbol!, method.matrixChain!)
        .then((res) => setMatrixAddress(res.address))
        .catch((e) => { setDepositMessage(e instanceof Error ? e.message : t('wallet.matrixDepositFetchFailed')); setDepositView('select'); setSelectedMethod(null) })
        .finally(() => setMatrixAddressLoading(false))
    } else {
      setDepositView('input')
      if (tab === 'deposit') {
        const isCrypto = /^(usdt|ton|btc|eth|bnb|matrix)/.test(selectedMethod) && !selectedMethod.startsWith('tg_wallet')
        if (!isCrypto) setAmount(DEFAULT_DEPOSIT_AMOUNTS[selectedMethod] ?? '')
      }
    }
  }, [selectedMethod])

  useEffect(() => { return () => { stopPolling(); stopTonPolling() } }, [])

  const liveFiatDeposit = useMemo((): PayMethod[] => FIAT_DEPOSIT.map((m) => {
    const ch = yfpayChannels.find((c) => c.code.toLowerCase().includes(m.id.toLowerCase()))
    if (ch) return { ...m, id: `yfpay_${m.id}`, tag: `₱${ch.min}–₱${ch.max}`, enabled: true, channelId: ch.code, yfpayChannelCode: ch.code, minAmount: ch.min, maxAmount: ch.max }
    return m
  }), [yfpayChannels])

  const allPayMethods = useMemo(() => [...TG_WALLET_DEPOSIT, ...liveFiatDeposit, ...CRYPTO_DEPOSIT, ...FIAT_WITHDRAW, ...CRYPTO_WITHDRAW], [liveFiatDeposit])
  const selectedPayMethod = useMemo(() => allPayMethods.find((m)=>m.id===selectedMethod), [allPayMethods, selectedMethod])
  const isTgWallet = selectedMethod?.startsWith('tg_wallet') ?? false
  const isYfPay = (selectedMethod ?? '').startsWith('yfpay_')
  const isTonConnect = selectedPayMethod?.channelId === 'ton_connect'
  const isFiatWithdraw = FIAT_WITHDRAW.some((m) => m.id === selectedMethod)
  const isMatrixWithdraw = selectedPayMethod?.channelId === 'matrix' && tab === 'withdraw'
  const isCryptoMethod = /usdt|ton|btc|eth|bnb/.test(selectedMethod ?? '') && !isTgWallet
  const depositCurrency = selectedPayMethod?.currency ?? 'PHP'
  const quickAmounts = depositCurrency === 'USDT' ? quickAmountsUsdt : quickAmountsPhp
  const yfpayQuickAmounts = useMemo((): string[] => {
    const m = selectedPayMethod; if(!m?.minAmount||!m?.maxAmount)return []
    const min=m.minAmount; const max=m.maxAmount; const step=Math.max(1,Math.round((max-min)/3))
    return [min,min+step,min+step*2,max].filter((v,i,a)=>a.indexOf(v)===i&&v<=max).map(String)
  }, [selectedPayMethod])
  const withdrawOptionCode = useMemo(() => ({'gcash-w':'GCASH','maya-w':'MAYA','bdo-w':'BDO','bpi-w':'BPI'}[selectedMethod??''])??'', [selectedMethod])
  const tonAddressShort = useMemo(() => { const addr=tonWalletAddress; if(!addr)return ''; return addr.length>20?`${addr.slice(0,10)}…${addr.slice(-6)}`:addr }, [tonWalletAddress])
  const canSubmitDeposit = Boolean(!depositLoading && selectedPayMethod?.channelId && Number(amount) > 0)
  const canSubmitWithdraw = Boolean(!withdrawLoading && isFiatWithdraw && Number(amount) > 0 && withdrawAccount.trim() && withdrawOwner.trim())
  const canSubmitMatrixWithdraw = Boolean(!withdrawLoading && isMatrixWithdraw && Number(amount) > 0 && Number(matrixCryptoAmount) > 0 && withdrawAccount.trim())
  const filteredHistory = useMemo(() => historyOrders.filter((tx) => (historyFilter==='all'||tx.type===historyFilter) && (historyStatus==='all'||tx.status===historyStatus)), [historyOrders, historyFilter, historyStatus])

  const localizedWalletBanners = useMemo(() => WALLET_BANNERS.map((b, i) => ({ ...b, label: t(`wallet.banners.${i}.label`), text: t(`wallet.banners.${i}.text`) })), [t])
  const walletTabs = useMemo(() => [{ id:'deposit' as const, label:t('wallet.deposit'), Icon:ArrowDownToLine }, { id:'withdraw' as const, label:t('wallet.withdraw'), Icon:ArrowUpFromLine }, { id:'history' as const, label:t('wallet.history'), Icon:History }], [t])

  function onBannerTouchStart(e: React.TouchEvent) { const t=e.touches[0]; if(!t)return; bannerDragRef.current={startX:t.clientX,startY:t.clientY,startScroll:walletBannerTrackRef.current?.scrollLeft??0,axis:null,lastX:t.clientX,lastT:Date.now()} }
  function onBannerTouchMove(e: React.TouchEvent) {
    const el=walletBannerTrackRef.current; const touch=e.touches[0]; if(!el||!touch)return
    const dx=touch.clientX-bannerDragRef.current.startX; const dy=touch.clientY-bannerDragRef.current.startY
    if(bannerDragRef.current.axis===null&&(Math.abs(dx)>8||Math.abs(dy)>8))bannerDragRef.current.axis=Math.abs(dx)>=Math.abs(dy)?'x':'y'
    if(bannerDragRef.current.axis!=='x')return; e.stopPropagation(); el.scrollLeft=bannerDragRef.current.startScroll-dx; bannerDragRef.current.lastX=touch.clientX; bannerDragRef.current.lastT=Date.now()
  }
  function onBannerTouchEnd() {
    if(bannerDragRef.current.axis==='x'){ const el=walletBannerTrackRef.current; if(el&&el.clientWidth>0){ const dx=bannerDragRef.current.startX-bannerDragRef.current.lastX; const vel=dx/Math.max(1,Date.now()-bannerDragRef.current.lastT); const th=el.clientWidth*0.18; const cur=bannerIdx; if(dx>th||vel>0.35){const n=Math.min(localizedWalletBanners.length-1,cur+1);el.scrollTo({left:n*el.clientWidth,behavior:'smooth'});setBannerIdx(n)}else if(dx<-th||vel<-0.35){const p=Math.max(0,cur-1);el.scrollTo({left:p*el.clientWidth,behavior:'smooth'});setBannerIdx(p)}else el.scrollTo({left:cur*el.clientWidth,behavior:'smooth'}) } }
    bannerDragRef.current.axis=null
  }

  const pollYfDepositCountRef = useRef(0)
  async function pollYfDeposit() {
    if(!pollSerial)return; pollYfDepositCountRef.current++; if(pollYfDepositCountRef.current>60){stopPolling();setDepositLoading(false);setDepositMessage(t('wallet.yfpayDepositTimeout'));return}
    try { const res=await queryYfDeposit(pollSerial); if(res.state===2){stopPolling();setDepositLoading(false);setDepositSuccess(true);setDepositMessage(t('wallet.yfpayDepositSuccess'));await walletStore.refresh()}else if(res.state===3){stopPolling();setDepositLoading(false);setDepositMessage(t('wallet.yfpayDepositRejected'))} } catch { /* keep polling */ }
  }

  async function onProceedYfDeposit() {
    const method=selectedPayMethod; if(!method?.yfpayChannelCode)return; const num=Number(amount)
    if(!Number.isFinite(num)||num<=0){setDepositMessage(t('wallet.invalidAmount'));return}
    if(method.minAmount&&num<method.minAmount){setDepositMessage(t('wallet.yfpayAmountOutOfRange',{min:method.minAmount,max:method.maxAmount}));return}
    if(method.maxAmount&&num>method.maxAmount){setDepositMessage(t('wallet.yfpayAmountOutOfRange',{min:method.minAmount,max:method.maxAmount}));return}
    setDepositLoading(true); setDepositMessage(t('wallet.yfpayOpenBrowser')); setDepositSuccess(false); stopPolling()
    try {
      const result=await createYfDeposit(num,method.yfpayChannelCode); setPollSerial(result.merchantSerial)
      if(window.Telegram?.WebApp?.openLink)window.Telegram.WebApp.openLink(result.payUrl); else window.open(result.payUrl,'_blank')
      setDepositMessage(t('wallet.yfpayWaitingPayment')); pollTimerRef.current=setInterval(()=>void pollYfDeposit(),3000)
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
    try{await createYfWithdrawal({amount:n,targetOwner:withdrawOwner.trim(),targetAccount:withdrawAccount.trim(),optionCode:withdrawOptionCode||undefined});setWithdrawSuccess(true);setWithdrawMessage(t('wallet.yfpayWithdrawPending'));await walletStore.refresh();setTimeout(()=>{setTab('history');setHistoryFilter('withdraw');void loadHistory()},1500)}catch(e){setWithdrawMessage(e instanceof ApiError?e.message:t('wallet.yfpayWithdrawFailed'))}finally{setWithdrawLoading(false)}
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
        amount: Number(amount),
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
      for(const d of bgDeposits){seen.add(d.orderId);items.push({id:d.orderId,orderId:d.orderId,type:'deposit',method:mapDepositChannelName(d.channelId),amount:`+₱${(d.creditedCents??d.amount).toFixed(2)}`,date:formatOrderDate(d.createdAt),sortKey:d.createdAt,status:mapDepositStatus(d.status)})}
      for(const w of bgWithdrawals){seen.add(w.orderId);items.push({id:w.orderId,orderId:w.orderId,type:'withdraw',method:mapDepositChannelName(w.channelId),amount:`-₱${w.amount.toFixed(2)}`,date:formatOrderDate(w.createdAt),sortKey:w.createdAt,status:mapDepositStatus(w.status)})}
      for(const d of yfDeposits)if(!seen.has(d.merchantSerial))items.push({id:d.merchantSerial,orderId:d.merchantSerial,type:'deposit',method:methodDisplayName(d.channelCode??''),amount:`+₱${d.amount.toFixed(2)}`,date:formatOrderDate(d.createdAt),sortKey:d.createdAt,status:mapDepositState(d.state)})
      for(const w of yfWithdrawals)if(!seen.has(w.merchantSerial))items.push({id:w.merchantSerial,orderId:w.merchantSerial,type:'withdraw',method:methodDisplayName(w.optionCode??''),amount:`-₱${w.amount.toFixed(2)}`,date:formatOrderDate(w.createdAt),sortKey:w.createdAt,status:mapWithdrawState(w.state)})
      items.sort((a,b)=>b.sortKey.localeCompare(a.sortKey)); setHistoryOrders(items)
    }catch{setHistoryOrders([])}finally{setHistoryLoading(false)}
  }

  async function copyOrderId(id: string) { try{await navigator.clipboard.writeText(id);setCopiedId(id);setTimeout(()=>setCopiedId(null),2000)}catch{/***/} }

  function resetToSelect() { setDepositView('select'); setSelectedMethod(null); setAmount(''); setDepositMessage(''); setWithdrawMessage(''); setWithdrawAccount(''); setWithdrawOwner(''); stopTonPolling(); setTonMessage(''); setTonLoading(false); setTonSuccess(false); setMatrixAddress(''); setMatrixCryptoAmount(''); setCopiedAddress(false) }

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
          <div className="flex items-center gap-2 text-xs font-bold"><span className="text-primary">{displayPhp}</span></div>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary transition-colors hover:bg-muted" onClick={onClose}><X size={15} className="text-muted-foreground" /></button>
        </div>

        <div className="flex flex-shrink-0 gap-2 px-5 pt-3">
          {walletTabs.map(({id, label, Icon}) => (
            <button key={id} type="button" className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-colors ${tab===id?'bg-primary text-primary-foreground shadow shadow-amber-500/20':'bg-secondary text-muted-foreground hover:text-foreground'}`}
              onClick={() => { setTab(id); setDepositView('select'); setSelectedMethod(null); setAmount(''); setDepositMessage(''); setWithdrawMessage('') }}
            ><Icon size={14} />{label}</button>
          ))}
        </div>

        {tab !== 'history' && (
          <div className="px-5 pt-3 flex-shrink-0">
            <div className="relative w-full rounded-2xl overflow-hidden h-20">
              <div ref={walletBannerTrackRef} className="flex h-full overflow-x-auto hide-scrollbar" style={{scrollSnapType:'x mandatory',WebkitOverflowScrolling:'touch'}} onTouchStart={onBannerTouchStart} onTouchMove={onBannerTouchMove} onTouchEnd={onBannerTouchEnd} onTouchCancel={onBannerTouchEnd}>
                {localizedWalletBanners.map((b,i) => (
                  <div key={i} className={`relative w-full flex-shrink-0 h-20 bg-gradient-to-br ${b.gradient}`} style={{scrollSnapAlign:'center'}}>
                    <div className="absolute inset-0 p-3.5 flex items-center justify-between">
                      <div><span className="text-white/60 text-[10px] font-bold uppercase tracking-wider block leading-none mb-1">{b.label}</span><span className="text-white font-black text-base leading-tight font-display">{b.text}</span></div>
                      <span className="text-4xl">{b.icon}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {localizedWalletBanners.map((_,i) => <span key={i} className={`h-1 rounded-full transition-all ${i===bannerIdx?'w-4 bg-white':'w-1 bg-white/40'}`} />)}
              </div>
            </div>
          </div>
        )}

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
              {depositView === 'matrix_address' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary hover:bg-muted transition-colors flex-shrink-0" onClick={resetToSelect}><ArrowLeft size={16} className="text-foreground" /></button>
                    <div className="flex items-center gap-2.5 flex-1 bg-secondary rounded-xl px-3 py-2.5">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 ${selectedPayMethod?.color??'from-muted to-muted'}`}><span className="text-white font-black text-sm">{selectedPayMethod?.icon}</span></div>
                      <div className="flex-1"><span className="text-foreground font-black text-sm">{selectedPayMethod?.name}</span></div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">{selectedPayMethod?.tag}</span>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{t('wallet.matrixDepositTitle')}</p>
                  {matrixAddressLoading ? (
                    <div className="flex flex-col items-center gap-3 py-8"><Loader2 size={28} className="text-primary animate-spin opacity-70" /></div>
                  ) : matrixAddress ? (
                    <>
                      <p className="text-xs text-muted-foreground text-center">{t('wallet.matrixDepositNote', { symbol: selectedPayMethod?.matrixSymbol, chain: selectedPayMethod?.matrixChain })}</p>
                      <div className="bg-secondary rounded-2xl px-4 py-3 space-y-2">
                        <p className="font-mono text-xs text-foreground break-all leading-relaxed">{matrixAddress}</p>
                        <button type="button" className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors w-full justify-center ${copiedAddress?'bg-emerald-500/20 text-emerald-400':'bg-muted text-muted-foreground hover:text-foreground'}`} onClick={()=>void copyMatrixAddress()}>
                          {copiedAddress?<Check size={13}/>:<Copy size={13}/>}{copiedAddress?t('common.copied'):t('common.copy')}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                        <ShieldCheck size={13} className="text-amber-400 flex-shrink-0" />
                        <span className="text-[11px] text-amber-300/80">{`Network: ${selectedPayMethod?.matrixChain} · Min 1 ${selectedPayMethod?.matrixSymbol}`}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-amber-400 text-center py-4">{depositMessage}</p>
                  )}
                </div>
              ) : depositView === 'select' ? (
                <div className="space-y-5">
                  {tab === 'deposit' ? (
                    <>
                      <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.fiatSection')}</p><PayMethodGrid methods={liveFiatDeposit} selected={selectedMethod} onSelect={(id)=>{setSelectedMethod(id);setAmount('');setDepositMessage('')}} /></div>
                      <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.tgWalletSection')}</p><PayMethodGrid methods={TG_WALLET_DEPOSIT} selected={selectedMethod} onSelect={(id)=>{setSelectedMethod(id);setAmount('');setDepositMessage('')}} /></div>
                      <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.cryptoSection')}</p><PayMethodGrid methods={CRYPTO_DEPOSIT} selected={selectedMethod} onSelect={setSelectedMethod} /></div>
                    </>
                  ) : (
                    <>
                      <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.fiatSection')}</p><PayMethodGrid methods={FIAT_WITHDRAW} selected={selectedMethod} onSelect={(id)=>{setSelectedMethod(id);setAmount('');setWithdrawMessage('');setWithdrawAccount('');setWithdrawOwner('')}} /></div>
                      <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.cryptoSection')}</p><PayMethodGrid methods={CRYPTO_WITHDRAW} selected={selectedMethod} onSelect={setSelectedMethod} /></div>
                    </>
                  )}
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
                  <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{tab==='deposit'?t('wallet.depositAmount'):t('wallet.withdrawAmount')}</p>
                  {tab==='deposit'&&isTonConnect&&<div className="flex gap-2 flex-wrap">{['1','5','10','50'].map((q)=><button key={q} type="button" className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${amount===q?'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`} onClick={()=>setAmount(q)}>{q} TON</button>)}</div>}
                  {tab==='deposit'&&isTgWallet&&<div className="flex gap-2 flex-wrap">{quickAmounts.map((q)=><button key={q} type="button" className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${amount===q?'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`} onClick={()=>setAmount(q)}>{depositCurrency==='USDT'?`$${q}`:`₱${q}`}</button>)}</div>}
                  {tab==='deposit'&&isYfPay&&yfpayQuickAmounts.length>0&&<div className="flex gap-2 flex-wrap">{yfpayQuickAmounts.map((q)=><button key={q} type="button" className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${amount===q?'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`} onClick={()=>setAmount(q)}>₱{q}</button>)}</div>}
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">{isTonConnect?'◈':isTgWallet&&depositCurrency==='USDT'?'$':isCryptoMethod?'≈ $':'₱'}</span>
                    <input value={amount} type="number" placeholder="0.00" className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary" onChange={(e)=>setAmount(e.target.value)} />
                  </div>
                  {tab==='withdraw'&&isFiatWithdraw&&<>
                    <input value={withdrawAccount} type="tel" placeholder={t('wallet.yfpayAccountNumber')} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setWithdrawAccount(e.target.value)} />
                    <input value={withdrawOwner} type="text" placeholder={t('wallet.yfpayFullName')} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setWithdrawOwner(e.target.value)} />
                  </>}
                  {isTonConnect&&tab==='deposit'&&amount&&Number(amount)>0&&<p className="text-xs text-muted-foreground text-center -mt-1">≈ ₱{(Number(amount)*350).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>}
                  {depositMessage&&<p className={`text-xs font-bold text-center ${depositSuccess?'text-emerald-400':'text-amber-400'}`}>{depositMessage}</p>}
                  {withdrawMessage&&!isMatrixWithdraw&&<p className={`text-xs font-bold text-center ${withdrawSuccess?'text-emerald-400':'text-amber-400'}`}>{withdrawMessage}</p>}
                  {tab==='deposit'&&isTonConnect&&<>
                    {tonIsConnected&&<div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2"><div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" /><span className="text-xs font-bold text-muted-foreground flex-1 truncate font-mono">{tonAddressShort}</span><button type="button" className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={()=>void disconnectTon()}>{t('wallet.tonDisconnect')}</button></div>}
                    {tonMessage&&<p className={`text-xs font-bold text-center ${tonSuccess?'text-emerald-400':'text-amber-400'}`}>{tonMessage}</p>}
                    <button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-sky-500 text-white hover:bg-sky-400 shadow-sky-500/20" disabled={tonLoading||!amount||Number(amount)<0.01} onClick={()=>void onProceedTonDeposit()}>
                      {tonLoading?<Loader2 size={18} className="animate-spin"/>:<span className="font-black text-lg leading-none">◈</span>}
                      {tonLoading?t('wallet.tonLoading'):tonIsConnected?t('wallet.tonPay'):t('wallet.tonConnect')}
                    </button>
                  </>}
                  {tab==='deposit'&&isTgWallet&&<button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20" disabled={!canSubmitDeposit} onClick={()=>void onProceedDeposit()}>{depositLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowDownToLine size={18} />}{depositLoading?t('wallet.openingPay'):t('wallet.payTelegram')}</button>}
                  {tab==='deposit'&&isYfPay&&!isTonConnect&&<button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20" disabled={!canSubmitDeposit||depositLoading} onClick={()=>void onProceedYfDeposit()}>{depositLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowDownToLine size={18} />}{depositLoading?t('wallet.yfpayWaitingPayment'):t('wallet.yfpayProceedDeposit')}</button>}
                  {tab==='withdraw'&&isMatrixWithdraw&&<>
                    <input value={withdrawAccount} type="text" placeholder={t('wallet.matrixWithdrawAddress', { symbol: selectedPayMethod?.matrixSymbol ?? 'TRX' })} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary font-mono" onChange={(e)=>setWithdrawAccount(e.target.value)} />
                    <input value={matrixCryptoAmount} type="number" placeholder={t('wallet.matrixCryptoAmount', { symbol: selectedPayMethod?.matrixSymbol ?? 'TRX' })} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setMatrixCryptoAmount(e.target.value)} />
                    <input value={amount} type="number" placeholder={t('wallet.matrixPhpDeduct')} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setAmount(e.target.value)} />
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
    </>,
    document.body,
  )
}
