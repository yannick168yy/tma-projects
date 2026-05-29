<template>
  <div>
    <h2 style="margin:0 0 16px">投注记录</h2>

    <!-- 统计卡片 -->
    <a-row :gutter="16" style="margin-bottom:16px">
      <a-col :span="6">
        <a-statistic title="总投注（PHP）" :value="stats.totalBet.toFixed(2)" prefix="₱" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="总派彩（PHP）" :value="stats.totalWin.toFixed(2)" prefix="₱" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="GGR（PHP）"
          :value="(stats.totalBet - stats.totalWin).toFixed(2)"
          prefix="₱"
          :value-style="{ color: stats.totalBet >= stats.totalWin ? '#3f8600' : '#cf1322' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="局数" :value="stats.roundCount" />
      </a-col>
    </a-row>

    <!-- 筛选 -->
    <a-space wrap style="margin-bottom:16px">
      <a-input v-model:value="filters.userId" placeholder="用户 ID" allow-clear style="width:160px" @pressEnter="load" />
      <a-select v-model:value="filters.betType" placeholder="类型" allow-clear style="width:110px" @change="load">
        <a-select-option value="bet">投注</a-select-option>
        <a-select-option value="win">派彩</a-select-option>
        <a-select-option value="refund">退款</a-select-option>
        <a-select-option value="cancel">取消</a-select-option>
      </a-select>
      <a-select v-model:value="filters.status" placeholder="状态" allow-clear style="width:110px" @change="load">
        <a-select-option value="pending">pending</a-select-option>
        <a-select-option value="settled">settled</a-select-option>
        <a-select-option value="failed">failed</a-select-option>
      </a-select>
      <a-range-picker
        v-model:value="dateRange"
        value-format="YYYY-MM-DD"
        style="width:240px"
        @change="load"
      />
      <a-button type="primary" @click="load">查询</a-button>
      <a-button @click="reset">重置</a-button>
    </a-space>

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
        <template v-if="column.key === 'betType'">
          <a-tag :color="betTypeColor(record.betType)">{{ betTypeLabel(record.betType) }}</a-tag>
        </template>
        <template v-if="column.key === 'amount'">
          <span>₱{{ Number(record.amount).toFixed(2) }}</span>
          <span v-if="record.originalAmount" style="color:#888; font-size:11px; margin-left:4px">
            ({{ record.currencyCode }} {{ Number(record.originalAmount).toFixed(4) }})
          </span>
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'createdAt'">
          <span style="font-size:12px; color:#888">{{ fmtTime(record.createdAt) }}</span>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { getBetOrders, type BetOrderRecord, type BetOrderStats } from '../api.js'

const loading = ref(false)
const items = ref<BetOrderRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const stats = reactive<BetOrderStats>({ totalBet: 0, totalWin: 0, roundCount: 0 })
const dateRange = ref<[string, string] | null>(null)

const filters = reactive({
  userId: '',
  betType: undefined as string | undefined,
  status: undefined as string | undefined,
})

const columns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
  { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 120, ellipsis: true },
  { title: '供应商', dataIndex: 'providerId', key: 'providerId', width: 130, ellipsis: true },
  { title: '局号', dataIndex: 'roundId', key: 'roundId', width: 130, ellipsis: true },
  { title: '类型', key: 'betType', width: 70 },
  { title: '金额', key: 'amount', width: 160 },
  { title: '状态', key: 'status', width: 90 },
  { title: '时间', key: 'createdAt', width: 150 },
]

function betTypeColor(t: string) {
  if (t === 'bet') return 'blue'
  if (t === 'win') return 'green'
  if (t === 'refund') return 'orange'
  return 'default'
}
function betTypeLabel(t: string) {
  return { bet: '投注', win: '派彩', refund: '退款', cancel: '取消' }[t] ?? t
}
function statusColor(s: string) {
  if (s === 'settled') return 'green'
  if (s === 'failed') return 'red'
  return 'default'
}
function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const res = await getBetOrders({
      page: page.value,
      pageSize,
      userId: filters.userId || undefined,
      betType: filters.betType,
      status: filters.status,
      dateFrom: dateRange.value?.[0],
      dateTo: dateRange.value?.[1],
    })
    items.value = res.items
    total.value = res.total
    Object.assign(stats, res.stats)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function reset() {
  filters.userId = ''
  filters.betType = undefined
  filters.status = undefined
  dateRange.value = null
  page.value = 1
  load()
}

onMounted(load)
</script>
