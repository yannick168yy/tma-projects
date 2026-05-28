<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px">
      <h2 style="margin:0">SG 结算对账</h2>
      <a-space>
        <a-date-picker v-model:value="reconcileDate" value-format="YYYY-MM-DD" placeholder="选择日期" />
        <a-button
          type="primary"
          :loading="reconciling"
          :disabled="!reconcileDate"
          @click="handleReconcile"
        >触发对账</a-button>
      </a-space>
    </div>

    <a-table
      :dataSource="items"
      :columns="columns"
      rowKey="id"
      :loading="loading"
      :pagination="{
        current: page,
        pageSize,
        total,
        showSizeChanger: false,
        showTotal: (t: number) => `共 ${t} 条`,
        onChange: (p: number) => { page = p; load() },
      }"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'reportDate'">
          <span style="font-weight:600">{{ record.reportDate }}</span>
        </template>
        <template v-if="column.key === 'sgAmounts'">
          <div style="line-height:1.6">
            <div>投注: <b>{{ Number(record.sgBetAmount).toFixed(2) }} {{ record.currency }}</b></div>
            <div>派彩: <b>{{ Number(record.sgWinAmount).toFixed(2) }} {{ record.currency }}</b></div>
            <div>GGR: <b :style="{ color: record.sgGgr >= 0 ? '#3f8600' : '#cf1322' }">{{ Number(record.sgGgr).toFixed(2) }} {{ record.currency }}</b></div>
          </div>
        </template>
        <template v-if="column.key === 'localAmounts'">
          <div style="line-height:1.6">
            <div>投注: <b>₱{{ (record.localBetCents / 100).toFixed(2) }}</b></div>
            <div>派彩: <b>₱{{ (record.localWinCents / 100).toFixed(2) }}</b></div>
            <div>GGR: <b :style="{ color: record.localBetCents >= record.localWinCents ? '#3f8600' : '#cf1322' }">
              ₱{{ ((record.localBetCents - record.localWinCents) / 100).toFixed(2) }}
            </b></div>
          </div>
        </template>
        <template v-if="column.key === 'discrepancy'">
          <a-tag v-if="!record.discrepancyNote" color="green">一致</a-tag>
          <a-tooltip v-else :title="record.discrepancyNote">
            <a-tag color="red">有差异</a-tag>
          </a-tooltip>
        </template>
        <template v-if="column.key === 'reconciled'">
          <a-tag v-if="record.reconciled" color="green">已核对</a-tag>
          <a-button
            v-else
            size="small"
            @click="handleMark(record)"
            :loading="markingId === record.id"
          >标记已核对</a-button>
        </template>
        <template v-if="column.key === 'fetchedAt'">
          <span style="font-size:11px; color:#888">{{ fmtTime(record.fetchedAt) }}</span>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { getSgSettlements, triggerReconcile, markReconciled, type SgSettlementRecord } from '../api.js'

const loading = ref(false)
const reconciling = ref(false)
const items = ref<SgSettlementRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const reconcileDate = ref<string>('')
const markingId = ref<number | null>(null)

const columns = [
  { title: '日期', key: 'reportDate', width: 110 },
  { title: '币种', dataIndex: 'currency', key: 'currency', width: 70 },
  { title: 'SG 数据', key: 'sgAmounts', width: 200 },
  { title: '本地数据（PHP）', key: 'localAmounts', width: 200 },
  { title: '局数', dataIndex: 'sgRoundCount', key: 'sgRoundCount', width: 80 },
  { title: '核对结果', key: 'discrepancy', width: 90 },
  { title: '核对状态', key: 'reconciled', width: 120 },
  { title: '拉取时间', key: 'fetchedAt', width: 150 },
]

function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const res = await getSgSettlements({ page: page.value, pageSize })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function handleReconcile() {
  if (!reconcileDate.value) return
  reconciling.value = true
  try {
    await triggerReconcile(reconcileDate.value)
    message.success(`${reconcileDate.value} 对账完成`)
    reconcileDate.value = ''
    load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '对账失败')
  } finally {
    reconciling.value = false
  }
}

async function handleMark(record: SgSettlementRecord) {
  markingId.value = record.id
  try {
    await markReconciled(record.id)
    record.reconciled = 1
    message.success('已标记核对')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    markingId.value = null
  }
}

onMounted(load)
</script>
