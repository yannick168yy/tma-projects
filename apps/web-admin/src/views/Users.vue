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
      size="small"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'balance'">
          ₱{{ Math.round(record.balanceCents / 100).toLocaleString() }}
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'label'">
          <a-tag :color="record.label === 'arbitrage' ? 'red' : 'default'">
            {{ labelText(record.label) }}
          </a-tag>
        </template>
        <template v-if="column.key === 'lastLoginAt'">
          <div>{{ record.lastLoginAt ? new Date(record.lastLoginAt).toLocaleString('zh-CN') : '-' }}</div>
          <div v-if="record.lastLoginRegion" style="color:#999;font-size:11px">{{ record.lastLoginRegion }}</div>
        </template>
        <template v-if="column.key === 'registerRegion'">
          {{ record.registerRegion || '-' }}
        </template>
        <template v-if="column.key === 'actions'">
          <a-space size="small">
            <a-button type="link" size="small" @click="$router.push(`/users/${record.id}`)">详情</a-button>
            <a-popconfirm
              v-if="record.status === 'active'"
              title="确定禁用该用户？"
              ok-text="禁用"
              cancel-text="取消"
              @confirm="doDisable(record)"
            >
              <a-button type="link" size="small" danger :loading="opUid === record.id">禁用</a-button>
            </a-popconfirm>
            <a-popconfirm
              v-if="record.status === 'frozen' || record.status === 'banned'"
              title="确定恢复该用户？"
              ok-text="恢复"
              cancel-text="取消"
              @confirm="doRestore(record)"
            >
              <a-button type="link" size="small" :loading="opUid === record.id">恢复</a-button>
            </a-popconfirm>
            <a-dropdown trigger="click">
              <a-button type="link" size="small">标记▾</a-button>
              <template #overlay>
                <a-menu @click="onLabelClick($event, record)">
                  <a-menu-item key="normal">普通</a-menu-item>
                  <a-menu-item key="arbitrage" style="color:red">套利客</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { getUsers, updateUserStatus, updateUserLabel, type AdminUser } from '../api.js'

const search = ref('')
const statusFilter = ref<string | undefined>()
const loading = ref(false)
const users = ref<AdminUser[]>([])
const total = ref(0)
const page = ref(1)
const opUid = ref<string | null>(null)

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
  { title: 'TG用户名', dataIndex: 'telegramUsername', key: 'tg', customRender: ({ value }: { value: string | null }) => value || '-' },
  { title: '余额', key: 'balance', width: 100 },
  { title: '状态', key: 'status', width: 80 },
  { title: '标记', key: 'label', width: 90 },
  { title: '注册区域', key: 'registerRegion', dataIndex: 'registerRegion', width: 120 },
  { title: '最后登录', key: 'lastLoginAt', width: 160 },
  { title: '操作', key: 'actions', width: 180 },
]

function statusColor(s: string) {
  return { active: 'green', frozen: 'orange', banned: 'red' }[s] ?? 'default'
}

function labelText(l: string) {
  return { normal: '普通', arbitrage: '套利客' }[l] ?? l
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

async function doRestore(record: AdminUser) {
  opUid.value = record.id
  try {
    await updateUserStatus(record.id, 'active')
    record.status = 'active'
    message.success('已恢复')
  } catch {
    message.error('操作失败')
  } finally {
    opUid.value = null
  }
}

async function doDisable(record: AdminUser) {
  opUid.value = record.id
  try {
    await updateUserStatus(record.id, 'frozen')
    record.status = 'frozen'
    message.success('已禁用')
  } catch {
    message.error('操作失败')
  } finally {
    opUid.value = null
  }
}

function onLabelClick(e: unknown, record: AdminUser) {
  const key = (e as { key: string }).key
  doLabel(record, key)
}

async function doLabel(record: AdminUser, label: string) {
  try {
    await updateUserLabel(record.id, label)
    record.label = label
    message.success(`已标记为：${labelText(label)}`)
  } catch {
    message.error('操作失败')
  }
}

onMounted(() => load())
</script>
