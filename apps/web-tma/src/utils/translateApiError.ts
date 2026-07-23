type Translate = (key: string, opts?: Record<string, unknown>) => string

/**
 * 后端把可本地化的错误以 i18n key 返回（约定 `errors.*`；带参数用 `errors.x:值`），
 * 前端展示前翻译；非 key 文案原样返回，兼容尚未 key 化的旧消息。
 */
export function translateApiError(message: string, t: Translate): string {
  if (/Matrix API error 1017/.test(message) || message.includes('商户未配置该币种')) {
    return t('wallet.matrixCurrencyUnavailable')
  }

  const withParam = message.match(/^((?:errors|auth\.errors|kyc\.errors)\.[a-zA-Z]+):(.+)$/)
  if (withParam) {
    const param = withParam[1].endsWith('smsFailedWithCode') ? { code: withParam[2] } : { value: withParam[2] }
    return t(withParam[1], param)
  }
  if (/^(?:errors|auth\.errors|kyc\.errors)\.[a-zA-Z]+$/.test(message)) return t(message)
  return message
}
