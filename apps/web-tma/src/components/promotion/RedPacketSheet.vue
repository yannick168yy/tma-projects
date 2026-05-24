<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePromotionStore } from '@/stores/promotion'

const { t } = useI18n()
const promo = usePromotionStore()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="promo.redPacketSheet.open"
      class="fixed inset-0 z-[95] flex items-end justify-center"
    >
      <div class="absolute inset-0 bg-black/75" @click="promo.closeRedPacket()" />
      <div class="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-gradient-to-b from-[#4a0e82] to-[#141B2D] p-6 pb-10 text-center">
        <p class="text-4xl mb-2">🧧</p>
        <h3 class="text-xl font-black text-white">{{ promo.redPacketSheet.title }}</h3>
        <p class="mt-2 text-3xl font-black text-primary">
          ₱ {{ promo.redPacketSheet.amountPhp.toLocaleString('en-PH') }}
        </p>
        <p class="mt-2 text-xs text-white/60">{{ t('redpacket.credited') }}</p>
        <button
          type="button"
          class="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
          @click="promo.closeRedPacket()"
        >
          {{ t('redpacket.awesome') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
