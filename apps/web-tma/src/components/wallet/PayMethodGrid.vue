<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next'
import type { PayMethod } from '@/data/wallet'

defineProps<{
  methods: PayMethod[]
  selected: string | null
}>()

const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="grid grid-cols-3 gap-2.5">
    <button
      v-for="m in methods"
      :key="m.id"
      type="button"
      class="relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all"
      :class="
        selected === m.id
          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
          : 'border-border bg-secondary hover:border-white/20'
      "
      @click="emit('select', m.id)"
    >
      <div
        class="w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md"
        :class="m.color"
      >
        <span class="text-white font-black" :style="{ fontSize: m.icon.length > 1 ? '20px' : '22px' }">
          {{ m.icon }}
        </span>
      </div>
      <span class="text-foreground font-bold text-xs leading-tight">{{ m.name }}</span>
      <span
        class="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
        :class="selected === m.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'"
      >
        {{ m.tag }}
      </span>
      <span v-if="selected === m.id" class="absolute top-1.5 right-1.5">
        <CheckCircle2 :size="13" class="text-primary" />
      </span>
    </button>
  </div>
</template>
