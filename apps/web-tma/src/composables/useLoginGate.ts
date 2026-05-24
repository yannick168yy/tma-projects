import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'

export function useLoginGate() {
  const auth = useAuthStore()
  const { isLoggedIn } = storeToRefs(auth)

  function gate(reason: string, action: () => void) {
    if (auth.requireLogin(reason)) {
      action()
    }
  }

  return { isLoggedIn, gate, auth }
}
