<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Gift } from 'lucide-vue-next'
import type { Category } from '@/data/categories'

const props = defineProps<{
  category: Category
  claimable: boolean
  claimLabel: string | null
}>()

const { t } = useI18n()
const label = computed(() => t(`category.${props.category.id}`))

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex-shrink-0 flex flex-col items-center gap-1.5 pt-2.5"
    @click="emit('click')"
  >
    <div class="relative overflow-visible">
      <!-- Claimable: glow ring hugs icon tile only -->
      <div
        v-if="claimable"
        class="pointer-events-none absolute -inset-[3px] rounded-[18px] bg-gradient-to-br from-amber-400 via-primary to-amber-500 opacity-90 animate-pulse"
        style="box-shadow: 0 0 14px rgba(251, 191, 36, 0.55)"
      />
      <!-- Flag ribbon floats outside card (must not sit inside overflow-hidden) -->
      <div
        v-if="claimLabel && !claimable"
        class="absolute left-2 top-[-11px] z-10 flex items-center gap-0.5 whitespace-nowrap bg-red-500 px-[7px] py-1 pl-[5px] text-[11px] font-black text-white"
        style="border-radius: 6px 6px 6px 0; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5)"
      >
        🔥 {{ claimLabel }}
        <span
          class="absolute bottom-[-6px] left-0 h-0 w-0"
          style="border-left: 6px solid #ef4444; border-bottom: 6px solid transparent"
        />
      </div>
      <div
        class="relative flex h-[59px] w-[110px] flex-col items-center justify-end rounded-2xl bg-gradient-to-br"
        :class="[category.color, claimable ? 'ring-2 ring-amber-300/80 ring-inset' : '']"
        style="box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45)"
      >
        <div class="flex w-full flex-1 items-center justify-center">
          <span class="text-[36px] leading-none">{{ category.icon }}</span>
        </div>
      </div>
      <div
        v-if="claimable"
        class="absolute -right-1 -top-2 z-20 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-500 to-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-black shadow-lg"
        style="box-shadow: 0 2px 10px rgba(251, 191, 36, 0.6)"
      >
        <Gift :size="10" stroke-width="3" />
        {{ t('common.claim') }}
      </div>
    </div>
    <span
      class="text-[12px] font-bold"
      :class="claimable ? 'text-primary' : 'text-white/80'"
    >
      {{ label }}
    </span>
  </button>
</template>
