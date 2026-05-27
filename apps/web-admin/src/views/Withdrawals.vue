<template>
  <div>
    <h2>提款审批</h2>
    <a-space style="margin-bottom:16px">
      <a-input v-model:value="userIdFilter" placeholder="用户ID" style="width:160px" allow-clear />
      <a-select v-model:value="statusFilter" placeholder="状态" allow-clear style="width:130px">
        <a-select-option value="pending">pending</a-select-option>
        <a-select-option value="processing">processing</a-select-option>
        <a-select-option value="completed">completed</a-select-option>
        <a-select-option value="rejected">rejected</a-select-option>
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
          <a-tag :color="wdStatusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'user'">
          <a-button type="link" size="small" @click="$router.push(`/users/${record.userId}`)">{{ record.userId }}</a-button>
        </template>
        <template v-if="column.key === 'actions'">
          <template v-if="record.status === 'pending'">
            <a-popconfirm title="确认批准此提款？" @confirm="doApprove(record.orderId)">
              <a-button type="link" size="small" style="color:#52c41a">批准</a-button>
            </a-popconfirm>
            <a-button type="link" size="small" danger @click="openRejectModal(record)">拒绝</a-button>
          </template>
          <span v-else>-</span>
        </template>
      </template>
    </a-table>

    <!-- 拒绝 modal -->
    <a-modal v-model:open="rejectModal.visible" title="拒绝原因" @ok="doReject" :confirm-loading="opLoading">
      <a-input v-model:value="rejectModal.reason" placeholder="请输入拒绝原因" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { getWithdrawals, approveWithdrawal, rejectWithdrawal, type AdminWithdrawal } from '../api.js'
import { message } from 'ant-design-vue'

const userIdFilter = ref('')
const statusFilter = ref<string | undefined>()
const loading = ref(false)
const opLoading = ref(false)
const items = ref<AdminWithdrawal[]>([])
const total = ref(0)
const page = ref(1)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

function onPageChange(p: { current: number }) { load(p.current) }

function wdStatusColor(s: string) {
  const m: Record<string, string> = { completed: 'green', pending: 'orange', processing: 'blue', rejected: 'red' }
  return m[s] ?? 'default'
}

const rejectModal = reactive({ visible: false, orderId: '', reason: '' })

const columns = [
  { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 200 },
  { title: '用户', key: 'user' },
  { title: '金额(分)', dataIndex: 'amount', key: 'amount' },
  { title: '渠道', dataIndex: 'channelId', key: 'channel' },
  { title: '状态', key: 'status' },
  { title: '创建时间', dataIndex: 'createdAt', key: 'at', customRender: ({ value }: { value: string }) => new Date(value).toLocaleString('zh-CN') },
  { title: '操作', key: 'actions' },
]

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await getWithdrawals({ page: p, pageSize: 20, userId: userIdFilter.value || undefined, status: statusFilter.value })
    items.value = res.items
    total.value = res.total
  } finally { loading.value = false }
}

async function doApprove(orderId: string) {
  opLoading.value = true
  try {
    await approveWithdrawal(orderId)
    message.success('已批准')
    await load(page.value)
  } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  finally { opLoading.value = false }
}

function openRejectModal(record: AdminWithdrawal) {
  rejectModal.orderId = record.orderId
  rejectModal.reason = ''
  rejectModal.visible = true
}

async function doReject() {
  if (!rejectModal.reason.trim()) { message.warning('请填写拒绝原因'); return }
  opLoading.value = true
  try {
    await rejectWithdrawal(rejectModal.orderId, rejectModal.reason)
    message.success('已拒绝，款项已退回用户')
    rejectModal.visible = false
    await load(page.value)
  } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  finally { opLoading.value = false }
}

onMounted(() => load())
</script>
