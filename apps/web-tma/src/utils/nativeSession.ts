interface SessionVaultPlugin {
  getToken(): Promise<{ token: string }>
  setToken(options: { token: string }): Promise<void>
  clearToken(): Promise<void>
}

async function getVault(): Promise<SessionVaultPlugin | null> {
  if (!/\bBetogoApp\//.test(navigator.userAgent)) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  return Capacitor.isNativePlatform() ? registerPlugin<SessionVaultPlugin>('SessionVault') : null
}

export async function restoreNativeToken(): Promise<string> {
  try { return (await (await getVault())?.getToken())?.token || '' } catch { return '' }
}

export function persistNativeToken(token: string): void {
  void getVault().then((vault) => vault?.setToken({ token })).catch(() => {})
}

export function clearNativeToken(): void {
  void getVault().then((vault) => vault?.clearToken()).catch(() => {})
}
