import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'

export function useLoginGate() {
  const auth = useAuthStore()
  const { isLoggedIn } = storeToRefs(auth)

  async function gate(reason: string, action: () => void) {
    if (await auth.ensureLoggedIn(reason)) {
      action()
    }
  }

  return { isLoggedIn, gate, auth }
}
