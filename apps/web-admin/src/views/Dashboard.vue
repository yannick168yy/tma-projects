<template>
  <div>
    <h2 style="margin-bottom:16px">数据概览</h2>
    <a-spin :spinning="loading">
      <a-row :gutter="16">
        <a-col :span="6" v-for="card in statCards" :key="card.label">
          <a-card :bordered="false" style="margin-bottom:16px">
            <a-statistic
              :title="card.label"
              :value="card.value"
              :precision="card.precision ?? 0"
              :prefix="card.prefix"
              :suffix="card.suffix"
              :value-style="card.color ? { color: card.color } : undefined"
            />
          </a-card>
        </a-col>
      </a-row>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { getDashboard } from '../api.js'

const loading = ref(false)
const stats = ref<{
  totalUsers: number; activeUsers: number; frozenUsers: number
  todayDepositCount: number; todayDepositAmount: number
  todayWithdrawCount: number; todayWithdrawAmount: number
  pendingWithdrawCount: number; totalBalance: number
} | null>(null)

const statCards = computed(() => {
  if (!stats.value) return []
  const s = stats.value
  type Card = { label: string; value: number; suffix?: string; color?: string; precision?: number; prefix?: string }
  const cards: Card[] = [
    { label: '总用户数', value: s.totalUsers },
    { label: '活跃用户', value: s.activeUsers, color: '#3f8600' },
    { label: '冻结用户', value: s.frozenUsers, color: '#cf1322' },
    { label: '今日存款笔数', value: s.todayDepositCount },
    { label: '今日存款金额', value: s.todayDepositAmount, suffix: ' PHP' },
    { label: '今日提款笔数', value: s.todayWithdrawCount },
    { label: '今日提款金额', value: Math.round(s.todayWithdrawAmount * 100) / 100, suffix: ' PHP' },
    { label: '待审批提款', value: s.pendingWithdrawCount, color: s.pendingWithdrawCount > 0 ? '#d46b08' : undefined },
    { label: '平台总余额', value: Math.round(s.totalBalance * 100) / 100, suffix: ' PHP' },
  ]
  return cards
})

onMounted(async () => {
  loading.value = true
  try { stats.value = await getDashboard() }
  finally { loading.value = false }
})
</script>
