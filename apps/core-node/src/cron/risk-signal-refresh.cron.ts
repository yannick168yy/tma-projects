import type { FastifyInstance } from 'fastify'
import { getAdminSetting, setAdminSetting } from '../services/win568-key-settings.service.js'
import { recomputeRiskSignals } from '../services/risk-signal.service.js'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000
const REFRESH_HOUR_PHT = 5 // PHT 05:00，排在 segment-refresh(04:00) 之后，避开同时段全表扫描
const LAST_RUN_KEY = 'user_risk_signal_last_refresh'

// 每分钟检查是否到点；启动时若今天还没算过则立即补一次
export function startRiskSignalRefreshCron(app: FastifyInstance): void {
  const interval = setInterval(() => void check(app), 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
  void check(app, true)
  app.log.info('[risk-signal] started, checking every minute (refresh at PHT 05:00)')
}

function phtDateStr(now = Date.now()): string {
  return new Date(now + PHT_OFFSET_MS).toISOString().slice(0, 10)
}

async function check(app: FastifyInstance, onStartup = false): Promise<void> {
  try {
    const today = phtDateStr()
    const last = await getAdminSetting(app, LAST_RUN_KEY)
    if (last === today) return

    const phtHour = new Date(Date.now() + PHT_OFFSET_MS).getUTCHours()
    if (!onStartup && phtHour !== REFRESH_HOUR_PHT) return

    // 先占位防并发/重入，失败再回退让下一分钟重试
    await setAdminSetting(app, LAST_RUN_KEY, today)
    try {
      const count = await recomputeRiskSignals(app.mysql)
      app.log.info({ count, date: today }, '[risk-signal] recomputed user risk signals')
    } catch (err) {
      await setAdminSetting(app, LAST_RUN_KEY, last ?? '')
      throw err
    }
  } catch (err) {
    app.log.error({ err }, '[risk-signal] failed')
  }
}
