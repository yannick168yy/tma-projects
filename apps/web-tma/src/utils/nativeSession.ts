import { Capacitor, registerPlugin } from '@capacitor/core'

interface SessionVaultPlugin {
  getToken(): Promise<{ token: string }>
  setToken(options: { token: string }): Promise<void>
  clearToken(): Promise<void>
}

const vault = registerPlugin<SessionVaultPlugin>('SessionVault')

export async function restoreNativeToken(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return ''
  try { return (await vault.getToken()).token || '' } catch { return '' }
}

export function persistNativeToken(token: string): void {
  if (!Capacitor.isNativePlatform()) return
  void vault.setToken({ token }).catch(() => {})
}

export function clearNativeToken(): void {
  if (!Capacitor.isNativePlatform()) return
  void vault.clearToken().catch(() => {})
}
