/** channelId 格式为 `{provider}_{channelName}`，如 yfpay_gcash；matrix 等无下划线时整段即 provider */
export function providerFromChannel(channelId: string): string | undefined {
  const i = channelId.indexOf('_')
  const p = i > 0 ? channelId.slice(0, i) : channelId
  return p || undefined
}
