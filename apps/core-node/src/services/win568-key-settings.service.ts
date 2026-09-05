import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'

export const WIN568_AUTO_ROTATION_ENABLED_KEY = 'win568_key_auto_rotation_enabled'
export const WIN568_OPERATION_COMPANY_KEY_SETTING = 'win568_operation_company_key'
export const WIN568_SW_COMPANY_KEY_SETTING = 'win568_sw_company_key'
// P1-5：有独立子代理的租户，子代理挂在自己的 ServerId 下。由平台控制台下发到租户库
export const WIN568_SERVER_ID_SETTING = 'win568_server_id'

export async function getAdminSetting(app: FastifyInstance, key: string): Promise<string | null> {
  const [rows] = await app.mysql.query<RowDataPacket[]>(
    `SELECT \`value\` FROM bg_admin_settings WHERE \`key\` = ?`,
    [key],
  )
  return rows[0] ? String(rows[0].value) : null
}

export async function setAdminSetting(app: FastifyInstance, key: string, value: string): Promise<void> {
  await app.mysql.execute(
    `INSERT INTO bg_admin_settings (\`key\`, \`value\`) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    [key, value],
  )
}

export async function isWin568AutoRotationEnabled(app: FastifyInstance): Promise<boolean> {
  const raw = await getAdminSetting(app, WIN568_AUTO_ROTATION_ENABLED_KEY)
  return raw !== '0'
}

export async function getWin568OperationCompanyKey(app: FastifyInstance): Promise<string> {
  return (await getAdminSetting(app, WIN568_OPERATION_COMPANY_KEY_SETTING))?.trim() || env.WIN568_COMPANY_KEY.trim()
}

export async function getWin568SwCompanyKey(app: FastifyInstance): Promise<string> {
  return (await getAdminSetting(app, WIN568_SW_COMPANY_KEY_SETTING))?.trim() || env.WIN568_SW_COMPANY_KEY.trim()
}

/** 租户库没配就回落平台 env —— 共用平台子代理的租户行为与改造前完全一致 */
export async function getWin568ServerId(app: FastifyInstance): Promise<string> {
  return (await getAdminSetting(app, WIN568_SERVER_ID_SETTING))?.trim() || env.WIN568_SERVER_ID.trim()
}
