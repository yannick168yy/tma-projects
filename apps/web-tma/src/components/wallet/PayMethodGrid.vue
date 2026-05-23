<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next'
import type { PayMethod } from '@/data/wallet'

defineProps<{
  methods: PayMethod[]
  selected: string | null
}>()

const emit = defineEmits<{ select: [id: string] }>()

function onSelect(id: string) {
  emit('select', id)
}

function onKeydown(e: KeyboardEvent, id: string) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onSelect(id)
  }
}
</script>

<template>
  <div class="grid grid-cols-3 gap-2.5">
    <div
      v-for="m in methods"
      :key="m.id"
      role="button"
      tabindex="0"
      class="sheet-scroll-tile relative flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 transition-all"
      :class="
        selected === m.id
          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
          : 'border-border bg-secondary hover:border-white/20'
      "
      @click="onSelect(m.id)"
      @keydown="onKeydown($event, m.id)"
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
    </div>
  </div>
</template>
