<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px">
      <h2 style="margin:0">汇率管理</h2>
      <a-space>
        <a-button :loading="refreshing" :disabled="refreshCooldown > 0" @click="handleRefresh">
          <sync-outlined />
          {{ refreshCooldown > 0 ? `${refreshCooldown}s 后可刷新` : '从 API 刷新' }}
        </a-button>
      </a-space>
    </div>

    <!-- 当前汇率卡片 -->
    <a-table
      :dataSource="rates"
      :columns="rateColumns"
      rowKey="from"
      :loading="loading"
      :pagination="false"
      style="margin-bottom:24px"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'rate'">
          <span v-if="record.rate !== null" style="font-size:15px; font-weight:600">
            {{ fmtRate(record.rate) }}
          </span>
          <a-tag v-else color="red">未配置</a-tag>
        </template>
        <template v-if="column.key === 'source'">
          <a-tag :color="sourceColor(record.source)">{{ sourceLabel(record.source) }}</a-tag>
        </template>
        <template v-if="column.key === 'fetchedAt'">
          <span style="color:#888; font-size:12px">{{ record.fetchedAt ? fmtTime(record.fetchedAt) : '—' }}</span>
        </template>
        <template v-if="column.key === 'action'">
          <a-space>
            <a-button size="small" type="primary" ghost @click="openEdit(record)">修改</a-button>
            <a-button
              v-if="record.source === 'manual'"
              size="small" danger
              @click="handleClearManual(record)"
            >恢复自动</a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 历史记录 -->
    <a-collapse>
      <a-collapse-panel key="history" header="汇率历史记录（最近 1000 条，按批次合并）">
        <a-table
          :dataSource="history"
          :columns="historyColumns"
          rowKey="id"
          :loading="histLoading"
          size="small"
          :pagination="{ pageSize: 20, showSizeChanger: false }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'fetchedAt'">
              <span style="color:#888; font-size:12px">{{ fmtTime((record as RateHistoryBatch).fetchedAt) }}</span>
            </template>
            <template v-else-if="['EUR','USD','USDT','TON'].includes(column.key)">
              <span style="font-size:12px">{{ fmtRate((record as RateHistoryBatch).rates?.[column.key]) }}</span>
            </template>
            <template v-else-if="column.key === 'hsource'">
              <a-tag :color="sourceColor((record as RateHistoryBatch).source)" style="font-size:11px">
                {{ sourceLabel((record as RateHistoryBatch).source) }}
              </a-tag>
            </template>
          </template>
        </a-table>
      </a-collapse-panel>
    </a-collapse>

    <!-- 编辑弹窗 -->
    <a-modal
      v-model:open="editOpen"
      :title="`设置汇率：${editForm.from} → ${editForm.to}`"
      @ok="handleSaveManual"
      :confirmLoading="saving"
      okText="保存"
      cancelText="取消"
    >
      <a-form layout="vertical" style="margin-top:8px">
        <a-form-item :label="`1 ${editForm.from} = ? PHP`">
          <a-input-number
            v-model:value="editForm.rate"
            :min="0.0001"
            :step="0.01"
            :precision="4"
            style="width:100%"
            placeholder="例如：62.5000"
          />
        </a-form-item>
        <a-alert type="info" show-icon style="margin-top:4px">
          <template #message>手动汇率有效期 7 天，期间不会被 API 自动覆盖。到期或点击"恢复自动"后恢复 API 汇率。</template>
        </a-alert>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive } from 'vue'
import { SyncOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import {
  getExchangeRates, getRateHistory, refreshExchangeRates,
  setManualRate, clearManualRate,
  type ExchangeRate, type RateHistoryBatch,
} from '../api.js'

const rates = ref<ExchangeRate[]>([])
const history = ref<RateHistoryBatch[]>([])
const loading = ref(false)
const histLoading = ref(false)
const refreshing = ref(false)
const saving = ref(false)
const refreshCooldown = ref(0)
let cdTimer: ReturnType<typeof setInterval> | null = null

const editOpen = ref(false)
const editForm = reactive({ from: '', to: '', rate: 0 })

const rateColumns = [
  { title: '货币对', key: 'pair', customRender: ({ record }: { record: ExchangeRate }) => `${record.from} → ${record.to}` },
  { title: '当前汇率（= PHP）', key: 'rate' },
  { title: '来源', key: 'source' },
  { title: '更新时间', key: 'fetchedAt' },
  { title: '操作', key: 'action', width: 160 },
]

const historyColumns = [
  { title: '时间', key: 'fetchedAt' },
  { title: 'EUR→PHP', key: 'EUR' },
  { title: 'USD→PHP', key: 'USD' },
  { title: 'USDT→PHP', key: 'USDT' },
  { title: 'TON→PHP', key: 'TON' },
  { title: '来源', key: 'hsource' },
]

function fmtRate(r: number | string | null | undefined): string {
  if (r === null || r === undefined) return '—'
  const n = typeof r === 'string' ? parseFloat(r) : r
  return isNaN(n) ? '—' : n.toFixed(4)
}

function sourceLabel(s: string | null) {
  if (!s) return '未知'
  if (s === 'manual') return '手动'
  if (s === 'env-fallback') return '环境变量兜底'
  if (s === 'freecurrencyapi' || s === 'exchangerate-api') return 'FreeCurrency'
  if (s === 'coingecko') return 'CoinGecko'
  if (s === 'identity') return '同币种'
  return s
}

function sourceColor(s: string | null) {
  if (s === 'manual') return 'orange'
  if (s === 'freecurrencyapi' || s === 'exchangerate-api') return 'green'
  if (s === 'coingecko') return 'blue'
  if (s === 'env-fallback') return 'gold'
  return 'default'
}

function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

async function loadRates() {
  loading.value = true
  try { rates.value = await getExchangeRates() }
  catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
  finally { loading.value = false }
}

async function loadHistory() {
  histLoading.value = true
  try { history.value = await getRateHistory() }
  catch (e) { message.error(e instanceof Error ? e.message : '加载历史失败') }
  finally { histLoading.value = false }
}

async function handleRefresh() {
  refreshing.value = true
  try {
    rates.value = await refreshExchangeRates()
    message.success('已从 API 刷新（手动覆盖的汇率未变动）')
    loadHistory()
    refreshCooldown.value = 10
    cdTimer = setInterval(() => {
      if (--refreshCooldown.value <= 0) { clearInterval(cdTimer!); cdTimer = null }
    }, 1000)
  } catch (e) { message.error(e instanceof Error ? e.message : '刷新失败') }
  finally { refreshing.value = false }
}

onUnmounted(() => { if (cdTimer) clearInterval(cdTimer) })

function openEdit(record: ExchangeRate) {
  editForm.from = record.from
  editForm.to = record.to
  editForm.rate = record.rate ?? 0
  editOpen.value = true
}

async function handleSaveManual() {
  if (!editForm.rate || editForm.rate <= 0) {
    message.warning('请输入有效汇率'); return
  }
  saving.value = true
  try {
    await setManualRate(editForm.from, editForm.to, editForm.rate)
    message.success(`${editForm.from}→${editForm.to} 汇率已设为 ${editForm.rate}，7 天内不自动刷新`)
    editOpen.value = false
    await loadRates()
  } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
  finally { saving.value = false }
}

async function handleClearManual(record: ExchangeRate) {
  try {
    await clearManualRate(record.from, record.to)
    message.success(`${record.from}→${record.to} 已恢复 API 自动汇率`)
    await loadRates()
  } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
}

onMounted(() => { loadRates(); loadHistory() })
</script>
