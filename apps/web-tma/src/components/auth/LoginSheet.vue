<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'
import BetogoLogo from '@/components/BetogoLogo.vue'
import { useAuthStore } from '@/stores/auth'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const loading = ref(false)
const error = ref<string | null>(null)

async function onTelegramLogin() {
  loading.value = true
  error.value = null
  try {
    await auth.loginWithTelegram()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    loading.value = false
  }
}

async function onGoogleLogin() {
  loading.value = true
  error.value = null
  try {
    await auth.loginWithGoogle()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div class="absolute inset-0 bg-black/70" @click="emit('close')" />
      <div
        class="relative z-10 w-full max-w-[430px] rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          class="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:text-foreground"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>

        <div class="mb-5 flex justify-center">
          <BetogoLogo />
        </div>
        <h2 class="text-center text-lg font-black text-foreground">Sign in to BetoGo</h2>
        <p class="mt-1 text-center text-xs text-muted-foreground">
          {{ auth.loginReason ?? 'Continue to play, deposit, and claim bonuses.' }}
        </p>
        <p v-if="auth.isTelegram" class="mt-2 text-center text-[10px] text-muted-foreground">
          BetoGo signs you in automatically when opened in Telegram. Use below if sign-in did not complete.
        </p>

        <div class="mt-6 space-y-3">
          <button
            v-if="auth.isTelegram"
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2AABEE] py-3 text-sm font-bold text-white disabled:opacity-60"
            :disabled="loading"
            @click="onTelegramLogin"
          >
            Retry Telegram sign-in
          </button>
          <button
            v-else
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-3 text-sm font-bold text-foreground disabled:opacity-60"
            :disabled="loading"
            @click="onGoogleLogin"
          >
            <span class="text-base">G</span>
            Continue with Google
          </button>
          <p v-if="!auth.isTelegram" class="text-center text-[10px] text-muted-foreground">
            You will be redirected to Google to sign in securely.
          </p>
        </div>

        <p v-if="error" class="mt-3 text-center text-xs text-red-400">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>
