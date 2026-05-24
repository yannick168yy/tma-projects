<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    /** Shown when #subtitle slot is not used */
    subtitle?: string
    connected?: boolean
    /** Highlight subtitle in connected color */
    subtitleConnected?: boolean
  }>(),
  {
    subtitle: '',
    connected: false,
    subtitleConnected: false,
  },
)
</script>

<template>
  <div class="flex items-center justify-between gap-3 px-4 py-3">
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg">
        <slot name="icon" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-bold leading-tight text-foreground">{{ title }}</p>
        <div v-if="$slots.subtitle" class="mt-0.5">
          <slot name="subtitle" />
        </div>
        <p
          v-else
          class="mt-0.5 truncate text-xs leading-snug"
          :class="subtitleConnected ? 'font-semibold text-emerald-400' : 'text-muted-foreground'"
        >
          {{ subtitle }}
        </p>
      </div>
    </div>
    <span
      v-if="connected"
      class="flex-shrink-0 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-black text-emerald-400"
    >
      Connected
    </span>
    <span
      v-else
      class="flex-shrink-0 rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground"
    >
      —
    </span>
  </div>
</template>
