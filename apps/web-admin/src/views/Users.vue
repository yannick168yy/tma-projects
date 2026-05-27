<template>
  <div>
    <h2>用户管理</h2>
    <a-space style="margin-bottom:16px">
      <a-input-search
        v-model:value="search"
        placeholder="搜索用户名/邮箱/ID"
        style="width:260px"
        @search="load(1)"
        allow-clear
      />
      <a-select v-model:value="statusFilter" placeholder="状态" allow-clear style="width:120px" @change="load(1)">
        <a-select-option value="active">活跃</a-select-option>
        <a-select-option value="frozen">冻结</a-select-option>
        <a-select-option value="banned">封禁</a-select-option>
      </a-select>
    </a-space>

    <a-table
      :columns="columns"
      :data-source="users"
      :loading="loading"
      :pagination="pagination"
      row-key="id"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'balance'">
          ₱{{ Math.round(record.balanceCents / 100).toLocaleString() }}
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="$router.push(`/users/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getUsers, type AdminUser } from '../api.js'

const search = ref('')
const statusFilter = ref<string | undefined>()
const loading = ref(false)
const users = ref<AdminUser[]>([])
const total = ref(0)
const page = ref(1)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

function onPageChange(p: { current: number }) {
  load(p.current)
}

const columns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
  { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
  { title: 'Email', dataIndex: 'email', key: 'email' },
  { title: 'TG用户名', dataIndex: 'telegramUsername', key: 'tg' },
  { title: '余额', key: 'balance' },
  { title: '状态', key: 'status' },
  { title: '注册时间', dataIndex: 'registeredAt', key: 'reg', customRender: ({ value }: { value: string }) => new Date(value).toLocaleString('zh-CN') },
  { title: '操作', key: 'actions' },
]

function statusColor(s: string) {
  return { active: 'green', frozen: 'orange', banned: 'red' }[s] ?? 'default'
}

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await getUsers({ page: p, pageSize: 20, search: search.value || undefined, status: statusFilter.value })
    users.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

onMounted(() => load())
</script>
