import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchPromoConfig, type LossRebateConfig } from '@/api/promotion'

interface Props {
  onOpenVipCenter: () => void
}

/** 负盈利返水介绍页（内容优先，后续再做视觉设计）。费率/门槛取自后台活动配置。 */
export default function LossRebatePage({ onOpenVipCenter }: Props) {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<LossRebateConfig | null>(null)

  useEffect(() => {
    fetchPromoConfig().then((c) => setCfg(c.lossRebate ?? null)).catch(() => null)
  }, [])

  const rate = cfg?.ratePct ?? 5
  const min = cfg?.minDeposit ?? 50

  return (
    <div className="page-main min-h-screen bg-[#080b14] text-white">
      <div className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-16">
        <header className="text-center">
          <div className="text-5xl">💸</div>
          <h1 className="mt-2 text-2xl font-black">{t('lossRebate.pageTitle')}</h1>
          <p className="mt-1 font-bold text-primary">{t('lossRebate.subtitle', { rate })}</p>
        </header>

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
            <li>{t('lossRebate.cond1', { min })}</li>
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
