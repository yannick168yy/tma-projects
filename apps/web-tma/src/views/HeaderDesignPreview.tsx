import { ChevronDown, Wallet, Plus, Zap } from 'lucide-react'
import BetogoLogo from '@/components/BetogoLogo'

function SimHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-background px-4 py-3">
      <div className="flex-shrink-0"><BetogoLogo /></div>
      <div className="flex flex-1 items-center justify-end">{children}</div>
    </div>
  )
}

function Label({ letter, name }: { letter: string; name: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
        {letter}
      </span>
      <span className="text-sm font-bold text-foreground">{name}</span>
    </div>
  )
}

function StateTag({ label }: { label: string }) {
  return <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
}

// ─── A · 合体分割胶囊（当前方案）────────────────────────────────────
function OptionALoggedIn() {
  return (
    <div className="flex h-9 items-center overflow-hidden rounded-full border border-white/10 shadow-sm shadow-black/20">
      <button type="button" className="flex h-full items-center gap-1.5 px-3.5">
        <span className="text-[11px] font-semibold text-muted-foreground">PHP</span>
        <span className="text-sm font-black tabular-nums text-white">1,000.00</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      <span className="h-5 w-px flex-shrink-0 bg-white/12" />
      <button type="button" className="flex h-full items-center bg-primary px-4 text-sm font-black text-primary-foreground">
        充值
      </button>
    </div>
  )
}
function OptionAGuest() {
  return (
    <button type="button" className="flex h-9 items-center overflow-hidden rounded-full border border-primary/35 shadow-md shadow-amber-500/15">
      <span className="px-4 text-sm font-semibold text-foreground/80">登录</span>
      <span className="h-5 w-px flex-shrink-0 bg-white/15" />
      <span className="flex h-full items-center bg-primary px-4 text-sm font-black text-primary-foreground">注册</span>
    </button>
  )
}

// ─── B · 双独立胶囊 ────────────────────────────────────────────────
function OptionBLoggedIn() {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/4 px-3.5 shadow-sm">
        <span className="text-[11px] font-semibold text-muted-foreground">PHP</span>
        <span className="text-sm font-black tabular-nums text-white">1,000.00</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      <button type="button" className="flex h-9 items-center rounded-full bg-primary px-4 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/20">
        充值
      </button>
    </div>
  )
}
function OptionBGuest() {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="flex h-9 items-center rounded-full border border-white/15 px-4 text-sm font-semibold text-foreground/80">
        登录
      </button>
      <button type="button" className="flex h-9 items-center rounded-full bg-primary px-4 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/20">
        注册
      </button>
    </div>
  )
}

// ─── C · 扁平文字 + 圆角充值条 ───────────────────────────────────
function OptionCLoggedIn() {
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-muted-foreground">PHP</span>
        <span className="text-[15px] font-black tabular-nums text-white leading-none">1,000.00</span>
        <ChevronDown size={10} className="text-muted-foreground/60" />
      </button>
      <button type="button" className="flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-black text-primary-foreground shadow-lg shadow-amber-500/25 active:brightness-90">
        <Plus size={12} strokeWidth={3} />
        <span>充值</span>
      </button>
    </div>
  )
}
function OptionCGuest() {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="text-sm font-semibold text-foreground/70 underline-offset-2 hover:underline">
        登录
      </button>
      <span className="text-white/20">/</span>
      <button type="button" className="flex h-8 items-center rounded-lg bg-primary px-4 text-xs font-black text-primary-foreground shadow-lg shadow-amber-500/25">
        立即注册
      </button>
    </div>
  )
}

// ─── D · 钱包图标卡 + 闪电充值 ───────────────────────────────────
function OptionDLoggedIn() {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="flex h-9 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 shadow-inner shadow-white/3">
        <Wallet size={13} className="flex-shrink-0 text-primary" />
        <div className="flex flex-col items-start leading-none">
          <span className="text-[9px] font-semibold text-muted-foreground">PHP</span>
          <span className="text-xs font-black tabular-nums text-white">1,000.00</span>
        </div>
        <ChevronDown size={10} className="text-muted-foreground" />
      </button>
      <button type="button" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-amber-500/25">
        <Zap size={16} className="text-primary-foreground" fill="currentColor" />
      </button>
    </div>
  )
}
function OptionDGuest() {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="flex h-9 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3.5">
        <span className="text-sm font-semibold text-foreground/70">登录</span>
      </button>
      <button type="button" className="flex h-9 items-center gap-1.5 rounded-2xl bg-primary px-3.5 shadow-lg shadow-amber-500/25">
        <Zap size={13} className="text-primary-foreground" fill="currentColor" />
        <span className="text-sm font-black text-primary-foreground">注册</span>
      </button>
    </div>
  )
}

// ─── 主预览页 ────────────────────────────────────────────────────
export default function HeaderDesignPreview() {
  const options: Array<{
    letter: string
    name: string
    loggedIn: React.ReactNode
    guest: React.ReactNode
  }> = [
    { letter: 'A', name: '合体分割胶囊（当前）', loggedIn: <OptionALoggedIn />, guest: <OptionAGuest /> },
    { letter: 'B', name: '双独立胶囊', loggedIn: <OptionBLoggedIn />, guest: <OptionBGuest /> },
    { letter: 'C', name: '扁平文字 + 圆角充值条', loggedIn: <OptionCLoggedIn />, guest: <OptionCGuest /> },
    { letter: 'D', name: '钱包图标卡 + 闪电充值', loggedIn: <OptionDLoggedIn />, guest: <OptionDGuest /> },
  ]

  return (
    <div className="space-y-8 px-4 py-6">
      <div>
        <h2 className="text-base font-black text-white">Header 设计方案对比</h2>
        <p className="mt-1 text-xs text-muted-foreground">共 4 个方案，每个展示登录态和未登录态</p>
      </div>

      {options.map((opt) => (
        <div key={opt.letter} className="space-y-3">
          <Label letter={opt.letter} name={opt.name} />

          <div className="space-y-2">
            <StateTag label="登录态" />
            <SimHeader>{opt.loggedIn}</SimHeader>
          </div>

          <div className="space-y-2">
            <StateTag label="未登录" />
            <SimHeader>{opt.guest}</SimHeader>
          </div>
        </div>
      ))}

      <p className="pb-4 text-center text-xs text-muted-foreground">告诉我选哪个方案 →</p>
    </div>
  )
}
