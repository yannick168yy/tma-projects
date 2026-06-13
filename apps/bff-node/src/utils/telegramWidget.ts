import { createHash, createHmac } from 'node:crypto'

export interface TelegramWidgetUser {
  id: number
  firstName?: string
  lastName?: string
  username?: string
  photoUrl?: string
  authDate: number
}

/**
 * 校验 Telegram Login Widget 回传数据。
 * 注意：与 Mini App initData 不同——widget 的 secret = SHA256(botToken)，
 * data_check_string 为各字段(除 hash)按 key 升序 `k=v` 换行拼接。
 */
export function verifyTelegramWidget(
  data: Record<string, string>,
  botToken: string,
  maxAgeSec = 86400,
): TelegramWidgetUser | null {
  const { hash, ...fields } = data
  if (!hash) return null

  const dataCheckString = Object.keys(fields)
    .filter((k) => fields[k] !== undefined && fields[k] !== '')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')

  const secret = createHash('sha256').update(botToken).digest()
  const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex')
  if (computed !== hash) return null

  const authDate = Number(fields.auth_date)
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null

  return {
    id: Number(fields.id),
    firstName: fields.first_name,
    lastName: fields.last_name,
    username: fields.username,
    photoUrl: fields.photo_url,
    authDate,
  }
}
