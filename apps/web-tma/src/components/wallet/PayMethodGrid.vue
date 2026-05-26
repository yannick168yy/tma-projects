<script setup lang="ts">
import { CheckCircle2, Lock, Send } from 'lucide-vue-next'
import type { PayMethod } from '@/data/wallet'

defineProps<{
  methods: PayMethod[]
  selected: string | null
}>()

const emit = defineEmits<{ select: [id: string] }>()

function isEnabled(m: PayMethod): boolean {
  return m.enabled !== false
}
</script>

<template>
  <div class="grid grid-cols-3 gap-2.5">
    <button
      v-for="m in methods"
      :key="m.id"
      type="button"
      class="relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all"
      :class="[
        !isEnabled(m) ? 'opacity-45 cursor-not-allowed border-border bg-secondary' : '',
        isEnabled(m) && selected === m.id
          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
          : isEnabled(m)
            ? 'border-border bg-secondary hover:border-white/20'
            : '',
      ]"
      :disabled="!isEnabled(m)"
      @click="isEnabled(m) && emit('select', m.id)"
    >
      <!-- Logo image (when iconUrl is set) -->
      <div v-if="m.iconUrl" class="w-11 h-11 rounded-xl overflow-hidden shadow-md flex-shrink-0">
        <img :src="m.iconUrl" :alt="m.name" class="w-full h-full object-cover" />
      </div>

      <!-- Gradient icon (fallback: emoji or telegram icon) -->
      <div
        v-else
        class="w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md"
        :class="m.color"
      >
        <Send
          v-if="m.iconKind === 'telegram'"
          :size="22"
          class="text-white"
          stroke-width="2.5"
        />
        <span
          v-else
          class="text-white font-black"
          :style="{ fontSize: m.icon.length > 1 ? '20px' : '22px' }"
        >
          {{ m.icon }}
        </span>
      </div>

      <span class="text-foreground font-bold text-xs leading-tight text-center">{{ m.name }}</span>
      <span
        class="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
        :class="selected === m.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'"
      >
        {{ m.tag }}
      </span>
      <span v-if="selected === m.id && isEnabled(m)" class="absolute top-1.5 right-1.5">
        <CheckCircle2 :size="13" class="text-primary" />
      </span>
      <span v-if="!isEnabled(m)" class="absolute top-1.5 right-1.5">
        <Lock :size="12" class="text-muted-foreground" />
      </span>
    </button>
  </div>
</template>
