interface SessionVaultPlugin {
  getToken(): Promise<{ token: string }>
  setToken(options: { token: string }): Promise<void>
  clearToken(): Promise<void>
}

// 插件必须包一层再 resolve：Capacitor 插件是 Proxy，读 then 也会拿到原生方法包装，
// Promise 把它当 thenable 调用后永不 resolve —— App 启动会卡死在加载页
async function getVault(): Promise<{ vault: SessionVaultPlugin } | null> {
  if (!/\bBetogoApp\//.test(navigator.userAgent)) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  return Capacitor.isNativePlatform() ? { vault: registerPlugin<SessionVaultPlugin>('SessionVault') } : null
}

export async function restoreNativeToken(): Promise<string> {
  try { return (await (await getVault())?.vault.getToken())?.token || '' } catch { return '' }
}

export function persistNativeToken(token: string): void {
  void getVault().then((v) => v?.vault.setToken({ token })).catch(() => {})
}

export function clearNativeToken(): void {
  void getVault().then((v) => v?.vault.clearToken()).catch(() => {})
}
