import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'
import { currentTenantOrNull, runWithTenant } from '../lib/tenant-context.js'
import { tenantById } from './tenant.service.js'
import {
  getPromoConfig, mergePromoConfig, savePromoConfig, validatePromoConfig, type PromoConfig,
} from './promo-config.service.js'

const log = childLogger('promo-template')

/**
 * 活动模板（P3-3）。
 *
 * 模板是「一套验证过的活动参数」，不是活动 DSL —— 见 012_promo_template.sql 里的取舍说明。
 * 套用走的是后台改配置的同一条路径（mergePromoConfig + validatePromoConfig + savePromoConfig），
 * 所以后台改不进去的值，套模板也进不去。
 */
export const PROMO_SECTIONS = [
  'trial', 'firstdep', 'appdl', 'redep', 'regularRedep', 'lossRebate', 'popups', 'bonusCards',
] as const
export type PromoSection = (typeof PROMO_SECTIONS)[number]

export const SECTION_LABEL: Record<PromoSection, string> = {
  trial: '体验金', firstdep: '首充嘉年华', appdl: 'App 下载礼金', redep: '限时复充',
  regularRedep: '常规复充', lossRebate: '负盈利返水', popups: '进站弹窗', bonusCards: '活动卡片',
}

export interface PromoTemplate {
  id: number
  code: string
  name: string
  description: string | null
  market: string | null
  sections: PromoSection[]
  config: Partial<PromoConfig>
  sourceTenantCode: string | null
  enabled: boolean
  applyCount: number
  createdAt: string
}

function parseConfig(raw: unknown): Partial<PromoConfig> {
  if (raw && typeof raw === 'object') return raw as Partial<PromoConfig>
  try { return JSON.parse(String(raw ?? '{}')) as Partial<PromoConfig> } catch { return {} }
}

export function sectionsOf(patch: Partial<PromoConfig>): PromoSection[] {
  return PROMO_SECTIONS.filter((k) => patch[k] !== undefined)
}

export async function listTemplates(): Promise<PromoTemplate[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT t.*, s.code AS source_code,
            (SELECT COUNT(*) FROM pf_promo_template_apply a WHERE a.template_id = t.id) AS apply_count
       FROM pf_promo_template t
       LEFT JOIN pf_tenant s ON s.id = t.source_tenant_id
      ORDER BY t.enabled DESC, t.id DESC`)
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    market: r.market,
    sections: String(r.sections ?? '').split(',').filter(Boolean) as PromoSection[],
    config: parseConfig(r.config),
    sourceTenantCode: r.source_code ?? null,
    enabled: r.enabled === 1,
    applyCount: Number(r.apply_count),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}

export interface TemplateInput {
  code: string
  name: string
  description?: string | null
  market?: string | null
  config: Partial<PromoConfig>
}

/** 存模板前也要过一遍校验：存一份非法参数进去，等到套用那天才报错最难查 */
export async function saveTemplate(
  input: TemplateInput, sourceTenantId: number | null, adminId: number | null,
): Promise<number> {
  const sections = sectionsOf(input.config)
  if (sections.length === 0) throw new Error('模板至少要包含一个活动区块')
  const patch: Partial<PromoConfig> = {}
  for (const k of sections) patch[k] = input.config[k] as never

  const [res] = await getPlatformPool().execute(
    `INSERT INTO pf_promo_template (code, name, description, market, config, sections, source_tenant_id, created_by)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
       market = VALUES(market), config = VALUES(config), sections = VALUES(sections)`,
    [input.code, input.name, input.description ?? null, input.market ?? null,
     JSON.stringify(patch), sections.join(','), sourceTenantId, adminId])
  return (res as { insertId: number }).insertId
}

export async function setTemplateEnabled(id: number, enabled: boolean): Promise<void> {
  await getPlatformPool().execute('UPDATE pf_promo_template SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
}

export async function deleteTemplate(id: number): Promise<boolean> {
  const [res] = await getPlatformPool().execute('DELETE FROM pf_promo_template WHERE id = ?', [id])
  return (res as { affectedRows: number }).affectedRows > 0
}

async function templateById(id: number): Promise<{ id: number; code: string; name: string; config: Partial<PromoConfig>; enabled: boolean } | null> {
  const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT id, code, name, config, enabled FROM pf_promo_template WHERE id = ?',
    [id]) as unknown as [RowDataPacket[]]
  if (!row) return null
  return { id: row.id, code: row.code, name: row.name, config: parseConfig(row.config), enabled: row.enabled === 1 }
}

export interface DiffRow {
  section: PromoSection
  label: string
  before: unknown
  after: unknown
}

/** 套用前先看差异：客户的活动参数是真金白银，不该点一下就被整套盖掉 */
export async function previewApply(env: Env, tenantId: number, templateId: number): Promise<{
  templateName: string
  diff: DiffRow[]
  error: string | null
}> {
  const tpl = await templateById(templateId)
  if (!tpl) throw new Error('模板不存在')
  const tenant = await tenantById(tenantId)
  if (!tenant) throw new Error('租户不存在')

  const current = await runWithTenant(tenant, () => getPromoConfig(env))
  const merged = mergePromoConfig(current, tpl.config)
  const diff: DiffRow[] = sectionsOf(tpl.config).map((section) => ({
    section,
    label: SECTION_LABEL[section],
    before: current[section],
    after: merged[section],
  }))
  return { templateName: tpl.name, diff, error: validatePromoConfig(merged) }
}

export async function applyTemplate(
  env: Env, tenantId: number, templateId: number,
  by: { name: string | null; side: 'platform' | 'tenant' },
): Promise<{ applied: PromoSection[] }> {
  const tpl = await templateById(templateId)
  if (!tpl) throw new Error('模板不存在')
  if (!tpl.enabled) throw new Error('该模板已停用')
  const tenant = await tenantById(tenantId)
  if (!tenant) throw new Error('租户不存在')

  const current = await runWithTenant(tenant, () => getPromoConfig(env))
  const merged = mergePromoConfig(current, tpl.config)
  const err = validatePromoConfig(merged)
  if (err) throw new Error(`套用后参数非法：${err}`)

  await runWithTenant(tenant, () => savePromoConfig(env, merged))
  // 套用前快照进记录：客户第二天说「活动怎么变了」要能拿出改动前的样子
  await getPlatformPool().execute(
    `INSERT INTO pf_promo_template_apply (template_id, tenant_id, applied_by, by_side, snapshot_before)
     VALUES (?,?,?,?,?)`,
    [templateId, tenantId, by.name, by.side, JSON.stringify(current)])
  const applied = sectionsOf(tpl.config)
  log.info({ tenant: tenant.code, template: tpl.code, applied, by }, '活动模板已套用')
  return { applied }
}

/** 从某个租户当前配置导出模板：这才是「取代逐家写代码」的现实路径 —— 调好一家，复制给后面的 */
export async function exportFromTenant(
  env: Env, tenantId: number, input: Omit<TemplateInput, 'config'> & { sections: PromoSection[] },
  adminId: number | null,
): Promise<number> {
  const tenant = await tenantById(tenantId)
  if (!tenant) throw new Error('租户不存在')
  const current = await runWithTenant(tenant, () => getPromoConfig(env))
  const patch: Partial<PromoConfig> = {}
  for (const k of input.sections) {
    if (PROMO_SECTIONS.includes(k)) patch[k] = current[k] as never
  }
  return saveTemplate({ ...input, config: patch }, tenantId, adminId)
}

export async function listApplyHistory(tenantId?: number): Promise<Array<{
  id: number; templateCode: string; templateName: string; tenantCode: string
  appliedBy: string | null; bySide: string; createdAt: string
}>> {
  const params: unknown[] = []
  let where = ''
  if (tenantId) { where = 'WHERE a.tenant_id = ?'; params.push(tenantId) }
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT a.id, a.applied_by, a.by_side, a.created_at, t.code AS tpl_code, t.name AS tpl_name, n.code AS tenant_code
       FROM pf_promo_template_apply a
       JOIN pf_promo_template t ON t.id = a.template_id
       JOIN pf_tenant n ON n.id = a.tenant_id
       ${where}
      ORDER BY a.id DESC LIMIT 100`, params)
  return rows.map((r) => ({
    id: r.id,
    templateCode: r.tpl_code,
    templateName: r.tpl_name,
    tenantCode: r.tenant_code,
    appliedBy: r.applied_by,
    bySide: r.by_side,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}

/** 租户后台自助套用（P3-5）：只能套到自己身上，tenantId 取上下文而不是入参 */
export async function applyTemplateForCurrentTenant(
  env: Env, templateId: number, adminUsername: string | null,
): Promise<{ applied: PromoSection[] }> {
  const tenant = currentTenantOrNull()
  if (!tenant) throw new Error('缺少租户上下文')
  return applyTemplate(env, tenant.id, templateId, { name: adminUsername, side: 'tenant' })
}

/**
 * 租户后台可见的模板：停用的不给看，配置内容也不下发（那是别家调出来的参数）。
 *
 * 按租户开通的**全部**市场过滤，不是取第一个 —— 多市场租户（自营站同时开 PH 与 ID）
 * 取第一个会把另一个市场的模板全挡掉，表现是「后台一个模板都看不到」。
 */
export async function listTemplatesForTenant(markets: string[]): Promise<Array<{
  id: number; name: string; description: string | null; sections: string[]; sectionLabels: string[]
}>> {
  const list = markets.filter(Boolean)
  const placeholders = list.length > 0 ? list.map(() => '?').join(',') : "''"
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT id, name, description, sections FROM pf_promo_template
      WHERE enabled = 1 AND (market IS NULL OR market IN (${placeholders})) ORDER BY id DESC`, list)
  return rows.map((r) => {
    const sections = String(r.sections ?? '').split(',').filter(Boolean)
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      sections,
      sectionLabels: sections.map((s) => SECTION_LABEL[s as PromoSection] ?? s),
    }
  })
}
