<template>
  <div>
    <a-page-header title="用户详情" @back="$router.back()" style="background:#fff; margin-bottom:16px; padding:16px" />
    <a-spin :spinning="loading">
      <a-row :gutter="16" v-if="detail">
        <!-- 基本信息 -->
        <a-col :span="12">
          <a-card title="基本信息" :bordered="false" style="margin-bottom:16px">
            <a-descriptions :column="1" bordered size="small">
              <a-descriptions-item label="ID">{{ detail.user.id }}</a-descriptions-item>
              <a-descriptions-item label="显示名">{{ detail.user.displayName }}</a-descriptions-item>
              <a-descriptions-item label="Email">{{ detail.user.email || '-' }}</a-descriptions-item>
              <a-descriptions-item label="TG用户名">{{ detail.user.telegramUsername || '-' }}</a-descriptions-item>
              <a-descriptions-item label="状态">
                <a-tag :color="statusColor(String(detail.user.status))">{{ detail.user.status }}</a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="注册时间">{{ fmtDate(String(detail.user.registeredAt)) }}</a-descriptions-item>
              <a-descriptions-item label="余额">₱{{ Math.round(detail.wallet.available / 100).toLocaleString() }}</a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-col>

        <!-- 操作 -->
        <a-col :span="12">
          <a-card title="管理操作" :bordered="false" style="margin-bottom:16px">
            <a-space direction="vertical" style="width:100%">
              <div>
                <div style="margin-bottom:8px; font-weight:500">修改状态</div>
                <a-space>
                  <a-select v-model:value="newStatus" style="width:120px">
                    <a-select-option value="active">活跃</a-select-option>
                    <a-select-option value="frozen">冻结</a-select-option>
                    <a-select-option value="banned">封禁</a-select-option>
                  </a-select>
                  <a-input v-model:value="statusReason" placeholder="原因（可选）" style="width:200px" />
                  <a-button type="primary" :loading="opLoading" @click="doUpdateStatus">确认</a-button>
                </a-space>
              </div>
              <a-divider />
              <div>
                <div style="margin-bottom:8px; font-weight:500">调整余额（单位：分，正加负减）</div>
                <a-space>
                  <a-input-number v-model:value="adjustCents" style="width:150px" />
                  <a-input v-model:value="adjustNote" placeholder="备注" style="width:200px" />
                  <a-button :loading="opLoading" @click="doAdjust">确认</a-button>
                </a-space>
              </div>
            </a-space>
          </a-card>
        </a-col>

        <!-- 账本 -->
        <a-col :span="24">
          <a-card title="最近账本（20条）" :bordered="false">
            <a-table :columns="ledgerCols" :data-source="detail.ledger" row-key="id" :pagination="false" size="small" />
          </a-card>
        </a-col>
      </a-row>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getUserDetail, updateUserStatus, adjustBalance } from '../api.js'
import { message } from 'ant-design-vue'

const route = useRoute()
const id = String(route.params.id)
const loading = ref(false)
const opLoading = ref(false)
const detail = ref<Awaited<ReturnType<typeof getUserDetail>> | null>(null)

const newStatus = ref('active')
const statusReason = ref('')
const adjustCents = ref(0)
const adjustNote = ref('')

const ledgerCols = [
  { title: 'ID', dataIndex: 'id', key: 'id' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '金额(分)', dataIndex: 'amount', key: 'amount' },
  { title: '余额(分)', dataIndex: 'balanceAfter', key: 'balanceAfter' },
  { title: '描述', dataIndex: 'description', key: 'desc' },
  { title: '时间', dataIndex: 'createdAt', key: 'at', customRender: ({ value }: { value: string }) => new Date(value).toLocaleString('zh-CN') },
]

function statusColor(s: string) { return { active: 'green', frozen: 'orange', banned: 'red' }[s] ?? 'default' }
function fmtDate(s: string) { return new Date(s).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  try { detail.value = await getUserDetail(id) }
  finally { loading.value = false }
}

async function doUpdateStatus() {
  opLoading.value = true
  try {
    await updateUserStatus(id, newStatus.value, statusReason.value || undefined)
    message.success('状态已更新')
    await load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally { opLoading.value = false }
}

async function doAdjust() {
  if (!adjustCents.value) { message.warning('请填写金额'); return }
  opLoading.value = true
  try {
    const res = await adjustBalance(id, adjustCents.value, adjustNote.value || undefined)
    message.success(`余额已调整，当前余额: ${res.available} 分`)
    await load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally { opLoading.value = false }
}

onMounted(load)
</script>
