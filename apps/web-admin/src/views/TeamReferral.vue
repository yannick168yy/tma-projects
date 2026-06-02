<template>
  <div>
    <h2 style="margin-bottom:16px">三级分销管理</h2>

    <!-- 概览卡 -->
    <a-row :gutter="16" style="margin-bottom:20px">
      <a-col :span="6">
        <a-statistic title="活跃代理" :value="overview.activeAgents" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="本月佣金总额" :value="phpDisplay(overview.thisMonthCommissionCents)" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="待审提现笔数" :value="overview.pendingWithdrawalCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="待审提现金额" :value="phpDisplay(overview.pendingWithdrawalCents)" />
      </a-col>
    </a-row>

    <!-- 费率配置 + 结算触发 -->
    <a-card title="佣金配置" style="margin-bottom:20px">
      <a-form layout="inline" :model="configForm" @finish="saveConfig">
        <a-form-item label="L1 比率(%)">
          <a-input-number v-model:value="configForm.l1_rate_pct" :min="0" :max="100" :step="0.5" style="width:90px" />
        </a-form-item>
        <a-form-item label="L2 比率(%)">
          <a-input-number v-model:value="configForm.l2_rate_pct" :min="0" :max="100" :step="0.5" style="width:90px" />
        </a-form-item>
        <a-form-item label="L3 比率(%)">
          <a-input-number v-model:value="configForm.l3_rate_pct" :min="0" :max="100" :step="0.5" style="width:90px" />
        </a-form-item>
        <a-form-item label="激活门槛(分)">
          <a-input-number v-model:value="configForm.min_activation_cents" :min="0" style="width:110px" />
        </a-form-item>
        <a-form-item label="最低提现(分)">
          <a-input-number v-model:value="configForm.min_withdrawal_cents" :min="0" style="width:110px" />
        </a-form-item>
        <a-form-item>
          <a-button type="primary" html-type="submit" :loading="configSaving">保存配置</a-button>
        </a-form-item>
        <a-form-item>
          <a-popconfirm
            :title="`确认触发 ${settlePeriod} 月结算？`"
            @confirm="doSettle">
            <a-space>
              <a-input v-model:value="settlePeriod" style="width:110px" placeholder="YYYY-MM" />
              <a-button :loading="settling">触发结算</a-button>
            </a-space>
          </a-popconfirm>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Tab -->
    <a-tabs v-model:activeKey="activeTab">

      <!-- 代理列表 -->
      <a-tab-pane key="agents" tab="代理列表">
        <a-space style="margin-bottom:12px">
          <a-input v-model:value="agentSearch" placeholder="搜索用户ID/昵称" allow-clear style="width:200px" />
          <a-button type="primary" @click="loadAgents(1)">查询</a-button>
        </a-space>
        <a-table
          :columns="agentCols"
          :data-source="agents"
          :loading="agentsLoading"
          :pagination="agentPagination"
          row-key="userId"
          size="small"
          @change="(p: { current: number }) => loadAgents(p.current)"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'thisMonth'">
              {{ phpDisplay(record.thisMonthCommissionCents) }}
            </template>
            <template v-if="column.key === 'lifetime'">
              {{ phpDisplay(record.lifetimeEarnedCents) }}
            </template>
            <template v-if="column.key === 'team'">
              L1:{{ record.l1Count }} / L2:{{ record.l2Count }} / L3:{{ record.l3Count }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- 佣金流水 -->
      <a-tab-pane key="commissions" tab="佣金流水">
        <a-space style="margin-bottom:12px">
          <a-input v-model:value="commFilter.period" placeholder="月份 YYYY-MM" allow-clear style="width:130px" />
          <a-input v-model:value="commFilter.beneficiaryId" placeholder="收益人ID" allow-clear style="width:150px" />
          <a-select v-model:value="commFilter.status" placeholder="状态" allow-clear style="width:110px">
            <a-select-option value="pending">pending</a-select-option>
            <a-select-option value="paid">paid</a-select-option>
            <a-select-option value="voided">voided</a-select-option>
          </a-select>
          <a-button type="primary" @click="loadCommissions(1)">查询</a-button>
        </a-space>
        <a-table
          :columns="commCols"
          :data-source="commissions"
          :loading="commissionsLoading"
          :pagination="commPagination"
          row-key="id"
          size="small"
          @change="(p: { current: number }) => loadCommissions(p.current)"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'ggr'">{{ phpDisplay(record.ggr_cents) }}</template>
            <template v-if="column.key === 'commission'">{{ phpDisplay(record.commission_cents) }}</template>
            <template v-if="column.key === 'status'">
              <a-tag :color="record.status === 'paid' ? 'green' : record.status === 'pending' ? 'orange' : 'default'">
                {{ record.status }}
              </a-tag>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- 提现审核 -->
      <a-tab-pane key="withdrawals" tab="提现审核">
        <a-space style="margin-bottom:12px">
          <a-select v-model:value="wdStatusFilter" placeholder="状态" allow-clear style="width:130px">
            <a-select-option value="pending">pending</a-select-option>
            <a-select-option value="approved">approved</a-select-option>
            <a-select-option value="rejected">rejected</a-select-option>
          </a-select>
          <a-button type="primary" @click="loadWithdrawals(1)">查询</a-button>
        </a-space>
        <a-table
          :columns="wdCols"
          :data-source="withdrawals"
          :loading="withdrawalsLoading"
          :pagination="wdPagination"
          row-key="id"
          size="small"
          @change="(p: { current: number }) => loadWithdrawals(p.current)"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'amount'">{{ phpDisplay(record.amount_cents) }}</template>
            <template v-if="column.key === 'status'">
              <a-tag :color="wdColor(record.status)">{{ record.status }}</a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <template v-if="record.status === 'pending'">
                <a-popconfirm title="确认批准此提现？" @confirm="doApprove(record.id)">
                  <a-button type="link" size="small" style="color:#52c41a">批准</a-button>
                </a-popconfirm>
                <a-button type="link" size="small" danger @click="openReject(record)">驳回</a-button>
              </template>
              <span v-else>-</span>
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- 驳回 modal -->
    <a-modal v-model:open="rejectModal.visible" title="驳回原因" @ok="doReject" :confirm-loading="opLoading">
      <a-input v-model:value="rejectModal.reason" placeholder="请输入驳回原因" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  getTeamOverview, getTeamAgents, getTeamCommissions, getTeamWithdrawals,
  getTeamConfig, updateTeamConfig, triggerTeamSettle,
  approveTeamWithdrawal, rejectTeamWithdrawal,
  type TeamOverview, type TeamAgent, type TeamCommission, type TeamWithdrawalAdmin, type TeamConfig,
} from '../api.js'

// ── 概览 ─────────────────────────────────────────────────────────────────────
const overview = reactive<TeamOverview>({ activeAgents: 0, thisMonthCommissionCents: 0, pendingWithdrawalCount: 0, pendingWithdrawalCents: 0 })

// ── 配置 ─────────────────────────────────────────────────────────────────────
const configForm  = reactive<Partial<TeamConfig>>({})
const configSaving = ref(false)
const settling    = ref(false)
const settlePeriod = ref(currentPeriod())

async function loadConfig() {
  const cfg = await getTeamConfig()
  Object.assign(configForm, cfg)
}

async function saveConfig() {
  configSaving.value = true
  try {
    await updateTeamConfig(configForm)
    message.success('配置已保存')
  } catch (e) {
    message.error('保存失败')
  } finally {
    configSaving.value = false
  }
}

async function doSettle() {
  settling.value = true
  try {
    await triggerTeamSettle(settlePeriod.value)
    message.success(`${settlePeriod.value} 结算已触发，后台处理中`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '触发失败')
  } finally {
    settling.value = false
  }
}

// ── 代理列表 ─────────────────────────────────────────────────────────────────
const activeTab    = ref('agents')
const agentSearch  = ref('')
const agents       = ref<TeamAgent[]>([])
const agentsTotal  = ref(0)
const agentsPage   = ref(1)
const agentsLoading = ref(false)

const agentPagination = computed(() => ({
  current: agentsPage.value, pageSize: 20, total: agentsTotal.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

const agentCols = [
  { title: '用户ID',    dataIndex: 'userId',      key: 'userId',   width: 110 },
  { title: '昵称',      dataIndex: 'displayName',  key: 'name' },
  { title: '团队规模',  key: 'team',               width: 160 },
  { title: '本月佣金',  key: 'thisMonth',           width: 120 },
  { title: '累计收益',  key: 'lifetime',            width: 120 },
  { title: '开启时间',  dataIndex: 'optedInAt',     key: 'optedInAt', width: 160 },
]

async function loadAgents(page = 1) {
  agentsLoading.value = true
  try {
    const data = await getTeamAgents({ search: agentSearch.value, page, pageSize: 20 })
    agents.value = data.items
    agentsTotal.value = data.total
    agentsPage.value = page
  } finally {
    agentsLoading.value = false
  }
}

// ── 佣金流水 ─────────────────────────────────────────────────────────────────
const commFilter = reactive({ period: '', beneficiaryId: '', status: undefined as string | undefined })
const commissions     = ref<TeamCommission[]>([])
const commissionsTotal = ref(0)
const commissionsPage  = ref(1)
const commissionsLoading = ref(false)

const commPagination = computed(() => ({
  current: commissionsPage.value, pageSize: 50, total: commissionsTotal.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

const commCols = [
  { title: '月份',       dataIndex: 'period',           key: 'period',     width: 90 },
  { title: '收益人',     dataIndex: 'beneficiary_name', key: 'beneficiary' },
  { title: '下线',       dataIndex: 'from_name',        key: 'from' },
  { title: '层级',       dataIndex: 'level',            key: 'level',      width: 60 },
  { title: 'GGR',       key: 'ggr',                    width: 110 },
  { title: '费率',       dataIndex: 'rate_pct',         key: 'rate',       width: 70 },
  { title: '佣金',       key: 'commission',             width: 110 },
  { title: '状态',       key: 'status',                 width: 90 },
]

async function loadCommissions(page = 1) {
  commissionsLoading.value = true
  try {
    const data = await getTeamCommissions({ ...commFilter, page })
    commissions.value = data.items
    commissionsTotal.value = data.total
    commissionsPage.value = page
  } finally {
    commissionsLoading.value = false
  }
}

// ── 提现审核 ─────────────────────────────────────────────────────────────────
const wdStatusFilter  = ref<string | undefined>()
const withdrawals     = ref<TeamWithdrawalAdmin[]>([])
const withdrawalsTotal = ref(0)
const withdrawalsPage  = ref(1)
const withdrawalsLoading = ref(false)
const opLoading = ref(false)
const rejectModal = reactive({ visible: false, id: 0, reason: '' })

const wdPagination = computed(() => ({
  current: withdrawalsPage.value, pageSize: 20, total: withdrawalsTotal.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

const wdCols = [
  { title: 'ID',     dataIndex: 'id',           key: 'id',      width: 80 },
  { title: '用户',   dataIndex: 'display_name', key: 'user' },
  { title: '用户ID', dataIndex: 'user_id',      key: 'userId',  width: 110 },
  { title: '金额',   key: 'amount',             width: 110 },
  { title: '状态',   key: 'status',             width: 90 },
  { title: '申请时间', dataIndex: 'created_at',  key: 'createdAt', width: 160 },
  { title: '操作',   key: 'actions',            width: 120 },
]

function wdColor(s: string) {
  return s === 'approved' ? 'green' : s === 'pending' ? 'orange' : s === 'rejected' ? 'red' : 'default'
}

async function loadWithdrawals(page = 1) {
  withdrawalsLoading.value = true
  try {
    const data = await getTeamWithdrawals({ status: wdStatusFilter.value, page })
    withdrawals.value = data.items
    withdrawalsTotal.value = data.total
    withdrawalsPage.value = page
  } finally {
    withdrawalsLoading.value = false
  }
}

async function doApprove(id: number) {
  opLoading.value = true
  try {
    await approveTeamWithdrawal(id)
    message.success('已批准')
    await Promise.all([loadWithdrawals(withdrawalsPage.value), loadOverview()])
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    opLoading.value = false
  }
}

function openReject(record: TeamWithdrawalAdmin) {
  rejectModal.id = record.id
  rejectModal.reason = ''
  rejectModal.visible = true
}

async function doReject() {
  opLoading.value = true
  try {
    await rejectTeamWithdrawal(rejectModal.id, rejectModal.reason)
    rejectModal.visible = false
    message.success('已驳回')
    await loadWithdrawals(withdrawalsPage.value)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    opLoading.value = false
  }
}

// ── 工具 ─────────────────────────────────────────────────────────────────────
function phpDisplay(cents: number) {
  return '₱' + ((cents ?? 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function loadOverview() {
  const data = await getTeamOverview()
  Object.assign(overview, data)
}

onMounted(() => {
  void loadOverview()
  void loadConfig()
  void loadAgents(1)
  void loadWithdrawals(1)
})
</script>
