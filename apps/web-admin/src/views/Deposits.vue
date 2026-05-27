<template>
  <div>
    <h2>存款管理</h2>
    <a-space style="margin-bottom:16px">
      <a-input v-model:value="userIdFilter" placeholder="用户ID" style="width:160px" allow-clear />
      <a-select v-model:value="statusFilter" placeholder="状态" allow-clear style="width:130px">
        <a-select-option value="pending">pending</a-select-option>
        <a-select-option value="paid">paid</a-select-option>
        <a-select-option value="failed">failed</a-select-option>
        <a-select-option value="cancelled">cancelled</a-select-option>
      </a-select>
      <a-button type="primary" @click="load(1)">查询</a-button>
    </a-space>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="pagination"
      row-key="orderId"
      size="small"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="depositStatusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'user'">
          <a-button type="link" size="small" @click="$router.push(`/users/${record.userId}`)">{{ record.userId }}</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getDeposits, type AdminDeposit } from '../api.js'

const userIdFilter = ref('')
const statusFilter = ref<string | undefined>()
const loading = ref(false)
const items = ref<AdminDeposit[]>([])
const total = ref(0)
const page = ref(1)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

function onPageChange(p: { current: number }) { load(p.current) }

const columns = [
  { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 200 },
  { title: '用户', key: 'user' },
  { title: '金额', dataIndex: 'amount', key: 'amount', customRender: ({ value, record }: { value: number; record: AdminDeposit }) => `${value} ${record.currency}` },
  { title: '渠道', dataIndex: 'channelId', key: 'channel' },
  { title: '状态', key: 'status' },
  { title: '创建时间', dataIndex: 'createdAt', key: 'at', customRender: ({ value }: { value: string }) => new Date(value).toLocaleString('zh-CN') },
  { title: '支付时间', dataIndex: 'paidAt', key: 'paidAt', customRender: ({ value }: { value: string | null }) => value ? new Date(value).toLocaleString('zh-CN') : '-' },
]

function depositStatusColor(s: string) {
  const m: Record<string, string> = { paid: 'green', pending: 'orange', failed: 'red', cancelled: 'default' }
  return m[s] ?? 'default'
}

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await getDeposits({ page: p, pageSize: 20, userId: userIdFilter.value || undefined, status: statusFilter.value })
    items.value = res.items
    total.value = res.total
  } finally { loading.value = false }
}

onMounted(() => load())
</script>
