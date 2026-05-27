import { TonConnectUI } from '@tonconnect/ui'
import { ref, readonly } from 'vue'

let _ui: TonConnectUI | null = null
const walletAddress = ref<string | null>(null)
const isConnected = ref(false)
let _subscribed = false

function getUI(): TonConnectUI {
  if (!_ui) {
    _ui = new TonConnectUI({
      manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
    })
  }
  return _ui
}

function ensureSubscribed() {
  if (_subscribed) return
  _subscribed = true
  const ui = getUI()
  if (ui.wallet) {
    walletAddress.value = ui.wallet.account.address
    isConnected.value = true
  }
  ui.onStatusChange((wallet) => {
    walletAddress.value = wallet?.account.address ?? null
    isConnected.value = !!wallet
  })
}

export function useTonConnect() {
  ensureSubscribed()

  async function connectWallet(): Promise<string> {
    if (isConnected.value && walletAddress.value) return walletAddress.value
    const ui = getUI()
    ui.openModal()
    return new Promise((resolve, reject) => {
      const unsub = ui.onStatusChange((wallet) => {
        if (wallet) {
          unsub()
          resolve(wallet.account.address)
        }
      })
      // Reject if modal is closed without connecting (5 min timeout)
      setTimeout(() => {
        unsub()
        reject(new Error('wallet_connect_timeout'))
      }, 5 * 60 * 1000)
    })
  }

  async function disconnect(): Promise<void> {
    await getUI().disconnect()
  }

  async function sendTransaction(toAddress: string, nanoTon: string): Promise<void> {
    await getUI().sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [{ address: toAddress, amount: nanoTon }],
    })
  }

  return {
    walletAddress: readonly(walletAddress),
    isConnected: readonly(isConnected),
    connectWallet,
    disconnect,
    sendTransaction,
  }
}
