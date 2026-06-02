import { TonConnectUI } from '@tonconnect/ui'
import { useState, useEffect } from 'react'

let _ui: TonConnectUI | null = null

function getUI(): TonConnectUI {
  if (!_ui) {
    _ui = new TonConnectUI({
      manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
    })
  }
  return _ui
}

export function useTonConnect() {
  const [walletAddress, setWalletAddress] = useState<string | null>(() => {
    const ui = getUI()
    return ui.wallet?.account.address ?? null
  })
  const [isConnected, setIsConnected] = useState(() => {
    const ui = getUI()
    return Boolean(ui.wallet)
  })

  useEffect(() => {
    const ui = getUI()
    const unsub = ui.onStatusChange((wallet) => {
      setWalletAddress(wallet?.account.address ?? null)
      setIsConnected(Boolean(wallet))
    })
    return unsub
  }, [])

  async function connectWallet(): Promise<string> {
    const ui = getUI()
    if (isConnected && walletAddress) return walletAddress
    ui.openModal()
    return new Promise((resolve, reject) => {
      const unsub = ui.onStatusChange((wallet) => {
        if (wallet) {
          unsub()
          resolve(wallet.account.address)
        }
      })
      setTimeout(() => {
        unsub()
        reject(new Error('wallet_connect_timeout'))
      }, 5 * 60 * 1000)
    })
  }

  async function disconnect() {
    await getUI().disconnect()
  }

  async function sendTransaction(toAddress: string, nanoTon: string) {
    await getUI().sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [{ address: toAddress, amount: nanoTon }],
    })
  }

  return { walletAddress, isConnected, connectWallet, disconnect, sendTransaction }
}
