<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import BetogoLogo from '@/components/BetogoLogo.vue'
import { completeGoogleLogin } from '@/api/auth'
import { clearStoredOAuthState, getGoogleRedirectUri, readStoredOAuthState } from '@/utils/googleOAuth'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const oauthError = params.get('error')
  const code = params.get('code')
  const state = params.get('state')

  if (oauthError) {
    loading.value = false
    error.value = `Google sign-in failed (${oauthError}).`
    return
  }

  if (!code) {
    loading.value = false
    error.value = 'Missing authorization code from Google.'
    return
  }

  if (state !== readStoredOAuthState()) {
    loading.value = false
    clearStoredOAuthState()
    error.value = 'Invalid OAuth state. Please sign in again.'
    return
  }

  try {
    const session = await completeGoogleLogin(code, getGoogleRedirectUri())
    auth.applySession(session)
    clearStoredOAuthState()
    window.location.replace('/')
  } catch (e) {
    clearStoredOAuthState()
    error.value = e instanceof Error ? e.message : 'Google login failed'
    loading.value = false
  }
})

function goHome() {
  window.location.replace('/')
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
    <BetogoLogo class="mb-6" />
    <Loader2 v-if="loading" :size="32" class="animate-spin text-primary" />
    <p v-if="loading" class="mt-4 text-sm text-muted-foreground">Signing you in with Google…</p>
    <p v-if="error && !loading" class="text-sm text-red-400">{{ error }}</p>
    <button
      v-if="error && !loading"
      type="button"
      class="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
      @click="goHome"
    >
      Back to home
    </button>
  </div>
</template>
