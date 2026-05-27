<template>
  <div>
    <h2>操作日志</h2>
    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="pagination"
      row-key="id"
      size="small"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'detail'">
          <a-tooltip :title="JSON.stringify(record.detail, null, 2)">
            <a-button type="link" size="small" v-if="record.detail">查看</a-button>
            <span v-else>-</span>
          </a-tooltip>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getAuditLog, type AuditEntry } from '../api.js'

const loading = ref(false)
const items = ref<AuditEntry[]>([])
const page = ref(1)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 50,
  total: items.value.length >= 50 ? page.value * 50 + 1 : (page.value - 1) * 50 + items.value.length,
  showTotal: () => `第 ${page.value} 页`,
}))

function onPageChange(p: { current: number }) { load(p.current) }

const columns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
  { title: '操作人', dataIndex: 'adminUsername', key: 'admin' },
  { title: '动作', dataIndex: 'action', key: 'action' },
  { title: '对象类型', dataIndex: 'targetType', key: 'type', customRender: ({ value }: { value: string | null }) => value ?? '-' },
  { title: '对象ID', dataIndex: 'targetId', key: 'tid', customRender: ({ value }: { value: string | null }) => value ?? '-' },
  { title: '详情', key: 'detail' },
  { title: 'IP', dataIndex: 'ip', key: 'ip', customRender: ({ value }: { value: string | null }) => value ?? '-' },
  { title: '时间', dataIndex: 'createdAt', key: 'at', customRender: ({ value }: { value: string }) => new Date(value).toLocaleString('zh-CN') },
]

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await getAuditLog({ page: p, pageSize: 50 })
    items.value = res.items
  } finally { loading.value = false }
}

onMounted(() => load())
</script>
