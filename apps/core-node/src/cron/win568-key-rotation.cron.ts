import type { FastifyInstance } from 'fastify'
import { Win568Client, type Win568Response } from '../clients/win568.client.js'
import {
  WIN568_OPERATION_COMPANY_KEY_SETTING,
  WIN568_SW_COMPANY_KEY_SETTING,
  getWin568OperationCompanyKey,
  getWin568SwCompanyKey,
  isWin568AutoRotationEnabled,
  setAdminSetting,
} from '../services/win568-key-settings.service.js'
import { runAsSelfOperated } from '../lib/tenant-jobs.js'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const ROTATE_BEFORE_MS = 14 * 24 * 60 * 60 * 1000

type ApiType = 'Operation' | 'SeamlessWallet'

interface KeyInfo {
  companyKey: string
  apiType: ApiType
  expirationDate: string
}

export function startWin568KeyRotationCron(app: FastifyInstance): void {
  // 平台级：按租户跑会把同一把 CompanyKey 轮换 N 次
  const run = () => void runAsSelfOperated(app, 'win568-key-rotation', () => checkWin568KeyRotation(app))
  const interval = setInterval(run, CHECK_INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[568win-key-rotation] started, checking daily')
}

async function checkWin568KeyRotation(app: FastifyInstance): Promise<void> {
  try {
    if (!await isWin568AutoRotationEnabled(app)) return

    let operationKey = await getWin568OperationCompanyKey(app)
    const swKey = await getWin568SwCompanyKey(app)
    if (!operationKey) return

    const client = new Win568Client(operationKey)
    const current = await client.getCurrentCompanyKeyInfo()
    if (current.error.id !== 0) {
      app.log.error({ error: current.error }, '[568win-key-rotation] get current key failed')
      return
    }

    const keys = collectKeyInfo(current)
    operationKey = await rotateOrSwitch(app, 'Operation', operationKey, WIN568_OPERATION_COMPANY_KEY_SETTING, keys, operationKey)
    await rotateOrSwitch(app, 'SeamlessWallet', swKey, WIN568_SW_COMPANY_KEY_SETTING, keys, operationKey)
  } catch (err) {
    app.log.error({ err }, '[568win-key-rotation] check failed')
  }
}

function collectKeyInfo(response: Win568Response): KeyInfo[] {
  const raw = Array.isArray(response.result) ? response.result : []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const obj = item as Record<string, unknown>
    if ((obj.apiType !== 'Operation' && obj.apiType !== 'SeamlessWallet') || typeof obj.companyKey !== 'string' || typeof obj.expirationDate !== 'string') {
      return []
    }
    return [{ apiType: obj.apiType, companyKey: obj.companyKey, expirationDate: obj.expirationDate }]
  })
}

async function rotateOrSwitch(
  app: FastifyInstance,
  apiType: ApiType,
  configuredKey: string,
  settingKey: string,
  allKeys: KeyInfo[],
  operationKey: string,
): Promise<string> {
  const keys = allKeys
    .filter((key) => key.apiType === apiType)
    .sort((a, b) => Date.parse(b.expirationDate) - Date.parse(a.expirationDate))
  if (keys.length === 0) return configuredKey

  const latest = keys[0]
  if (latest.companyKey !== configuredKey && Date.parse(latest.expirationDate) > Date.now()) {
    await setAdminSetting(app, settingKey, latest.companyKey)
    app.log.info({ apiType, expirationDate: latest.expirationDate }, '[568win-key-rotation] switched to newer active key')
    return latest.companyKey
  }

  if (keys.length > 1) return configuredKey

  const current = keys.find((key) => key.companyKey === configuredKey)
  if (!current || Date.parse(current.expirationDate) - Date.now() > ROTATE_BEFORE_MS) return configuredKey

  const rotated = await new Win568Client(operationKey).regenerateCompanyKey(apiType)
  if (rotated.error.id !== 0 || !rotated.companyKey) {
    app.log.error({ apiType, error: rotated.error }, '[568win-key-rotation] regenerate key failed')
    return configuredKey
  }

  await setAdminSetting(app, settingKey, rotated.companyKey)
  app.log.info({ apiType, expirationDate: rotated.expirationDate }, '[568win-key-rotation] regenerated key')
  return rotated.companyKey
}
