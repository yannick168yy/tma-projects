<script setup lang="ts">
defineProps<{
  brand: 'telegram' | 'google' | 'phone' | 'email'
}>()
</script>

<template>
  <svg
    v-if="brand === 'telegram'"
    viewBox="0 0 240 240"
    class="h-8 w-8"
    aria-hidden="true"
  >
    <circle cx="120" cy="120" r="120" fill="#2AABEE" />
    <path
      fill="#fff"
      d="M81.6 118.8 214.8 170c3.4 1.2 3.4 5.8 0 7l-22.4 8.4-8.6 29.8c-1.2 4.2-6.8 4.6-8.8.8l-13-21-25.4 18.6c-2.2 1.6-5.2.2-5.8-2.4l-18.8-88.8c-.8-3.8 3.2-6.6 6.6-4.8z"
    />
  </svg>

  <svg
    v-else-if="brand === 'google'"
    viewBox="0 0 24 24"
    class="h-8 w-8"
    aria-hidden="true"
  >
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>

  <div
    v-else-if="brand === 'email'"
    class="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary"
    aria-hidden="true"
  >
    <svg viewBox="0 0 24 24" class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" stroke-width="2">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  </div>

  <div
    v-else
    class="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary"
    aria-hidden="true"
  >
    <svg viewBox="0 0 24 24" class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" stroke-width="2">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
      />
    </svg>
  </div>
</template>
