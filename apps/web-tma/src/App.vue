<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import AppShell from '@/views/AppShell.vue'
import SplashPage from '@/views/SplashPage.vue'
import GoogleAuthCallback from '@/views/GoogleAuthCallback.vue'
import LoginSheet from '@/components/auth/LoginSheet.vue'
import RedPacketSheet from '@/components/promotion/RedPacketSheet.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { phase, bootError, loginSheetOpen } = storeToRefs(auth)

const isGoogleCallback =
  typeof window !== 'undefined' && window.location.pathname === '/auth/google/callback'

onMounted(() => {
  if (!isGoogleCallback) void auth.bootstrap()
})
</script>

<template>
  <GoogleAuthCallback v-if="isGoogleCallback" />
  <template v-else>
    <SplashPage v-if="phase === 'splash'" :error="bootError" />
    <AppShell v-else />
    <LoginSheet :open="loginSheetOpen" @close="auth.closeLoginSheet()" />
    <RedPacketSheet />
  </template>
</template>
