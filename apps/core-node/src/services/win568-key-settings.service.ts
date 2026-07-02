import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'

export const WIN568_AUTO_ROTATION_ENABLED_KEY = 'win568_key_auto_rotation_enabled'
export const WIN568_OPERATION_COMPANY_KEY_SETTING = 'win568_operation_company_key'
export const WIN568_SW_COMPANY_KEY_SETTING = 'win568_sw_company_key'

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
