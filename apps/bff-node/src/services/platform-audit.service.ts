import { getPlatformPool } from '../clients/platform-mysql.client.js'

/** 平台侧所有写操作都要留痕：包网运营出纠纷时这是唯一的事实依据 */
export async function writeAudit(
  adminId: number | null,
  ip: string,
  action: string,
  tenantId: number | null,
  detail: unknown,
): Promise<void> {
  await getPlatformPool().execute(
    'INSERT INTO pf_audit_log (admin_id, tenant_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)',
    [adminId, tenantId, action, JSON.stringify(detail), ip],
  ).catch(() => { /* 审计写失败不阻断业务；失败本身会进服务日志 */ })
}
