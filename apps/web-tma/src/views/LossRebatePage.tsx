import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchPromoConfig, type LossRebateConfig } from '@/api/promotion'
import { fetchLossRebateStatus, type LossRebateStatus } from '@/api/vip'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useAuthStore } from '@/stores/auth'

interface Props {
  onOpenVipCenter: () => void
}

/** 负盈利返水介绍页。费率/门槛取自后台活动配置；顶部展示用户「今日至今」返水实时状态。 */
export default function LossRebatePage({ onOpenVipCenter }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const [cfg, setCfg] = useState<LossRebateConfig | null>(null)
  const [status, setStatus] = useState<LossRebateStatus | null>(null)

  useEffect(() => {
    fetchPromoConfig().then((c) => setCfg(c.lossRebate ?? null)).catch(() => null)
  }, [])

  useEffect(() => {
    if (!token) { setStatus(null); return }
    fetchLossRebateStatus(activeCurrency).then(setStatus).catch(() => setStatus(null))
  }, [token, activeCurrency])

  const rate = cfg?.ratePct ?? 5
  // 门槛按当前币种（状态接口已返回该币种门槛；未登录回落配置的 PHP 值）
  const min = status?.minDeposit ?? cfg?.minDeposit ?? 50
  const fmt = (v: number) => formatCurrencyAmount(activeCurrency, v)

  return (
    <div className="page-main min-h-screen bg-[#080b14] text-white">
      <div className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-16">
        <header className="text-center">
          <div className="text-5xl">💸</div>
          <h1 className="mt-2 text-2xl font-black">{t('lossRebate.pageTitle')}</h1>
          <p className="mt-1 font-bold text-primary">{t('lossRebate.subtitle', { rate })}</p>
        </header>

        {status?.enabled && (status.netLoss > 0 || status.pendingClaimable > 0) && (
          <section className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
            <h2 className="mb-2 text-sm font-bold text-primary">{t('lossRebate.status.title')}</h2>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">{t('lossRebate.status.netLoss')}</span>
              <span className="font-black text-white">{fmt(status.netLoss)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-white/70">{t('lossRebate.status.potential', { rate: status.ratePct })}</span>
              <span className="font-black text-primary">{fmt(status.potentialRebate)}</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-white/60">
              {status.pendingClaimable > 0
                ? t('lossRebate.status.pending', { amt: fmt(status.pendingClaimable) })
                : status.reason === 'need_deposit'
                  ? t('lossRebate.status.needDeposit', { min: fmt(status.minDeposit), dep: fmt(status.todayDeposit) })
                  : t('lossRebate.status.eligible')}
            </p>
            {(status.pendingClaimable > 0 || status.eligible) && (
              <button
                type="button"
                onClick={onOpenVipCenter}
                className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-black text-primary-foreground active:scale-95 transition-transform"
              >
                {t('lossRebate.claimCta')}
              </button>
            )}
          </section>
        )}

        <Section title={t('lossRebate.introTitle')}>
          <p>{t('lossRebate.introBody', { rate })}</p>
        </Section>

        <Section title={t('lossRebate.howTitle')}>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('lossRebate.how1')}</li>
            <li>{t('lossRebate.how2', { rate })}</li>
            <li>{t('lossRebate.how3')}</li>
          </ul>
        </Section>

        <Section title={t('lossRebate.gamesTitle')}>
          <p>{t('lossRebate.gamesBody')}</p>
        </Section>

        <Section title={t('lossRebate.condTitle')}>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('lossRebate.cond1', { min: fmt(min) })}</li>
            <li>{t('lossRebate.cond2')}</li>
          </ul>
        </Section>

        <Section title={t('lossRebate.claimTitle')}>
          <p>{t('lossRebate.claimBody')}</p>
          <button
            type="button"
            onClick={onOpenVipCenter}
            className="mt-3 w-full rounded-xl bg-primary py-3 font-black text-primary-foreground active:scale-95 transition-transform"
          >
            {t('lossRebate.claimCta')}
          </button>
        </Section>

        <p className="text-center text-[11px] leading-relaxed text-white/40">{t('lossRebate.disclaimer')}</p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-2 text-sm font-bold text-white">{title}</h2>
      <div className="text-sm leading-relaxed text-white/70">{children}</div>
    </section>
  )
}
