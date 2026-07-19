import type { FastifyInstance } from 'fastify'
import { getAdminSetting, setAdminSetting } from '../services/win568-key-settings.service.js'
import { recomputeSegments } from '../services/segment.service.js'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000
const REFRESH_HOUR_PHT = 4 // 每天 PHT 04:00 重算（低峰）
const LAST_RUN_KEY = 'user_segment_last_refresh' // 存 PHT 日期，防同日重跑

// 每分钟检查是否到点；启动时若今天还没算过则立即补一次，让分层数据尽快可用
export function startSegmentRefreshCron(app: FastifyInstance): void {
  const interval = setInterval(() => void check(app), 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
  void check(app, true)
  app.log.info('[segment-refresh] started, checking every minute (refresh at PHT 04:00)')
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
    // 到点触发；或启动时今天从未算过也补一次（防容器整天没到 04:00 而分层空着）
    if (!onStartup && phtHour !== REFRESH_HOUR_PHT) return

    // 先占位防并发/重入，失败再回退让下一分钟重试
    await setAdminSetting(app, LAST_RUN_KEY, today)
    try {
      const count = await recomputeSegments(app.mysql)
      app.log.info({ count, date: today }, '[segment-refresh] recomputed user segments')
    } catch (err) {
      await setAdminSetting(app, LAST_RUN_KEY, last ?? '')
      throw err
    }
  } catch (err) {
    app.log.error({ err }, '[segment-refresh] failed')
  }
}
