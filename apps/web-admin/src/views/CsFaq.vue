<template>
  <div>
    <h2>知识库管理</h2>
    <a-space style="margin-bottom:16px" wrap>
      <a-input-search
        v-model:value="keyword"
        placeholder="搜索问题/答案"
        style="width:220px"
        allow-clear
        @search="load(1)"
      />
      <a-select v-model:value="categoryFilter" placeholder="全部分类" allow-clear style="width:140px" @change="load(1)">
        <a-select-option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</a-select-option>
      </a-select>
      <a-button type="primary" @click="openCreate">+ 新增 FAQ</a-button>
    </a-space>

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
        <template v-if="column.key === 'category'">
          <a-tag :color="categoryColor(record.category)">{{ categoryLabel(record.category) }}</a-tag>
        </template>
        <template v-if="column.key === 'answer'">
          <a-typography-text :ellipsis="{ tooltip: record.answer }" style="max-width:320px; display:inline-block">
            {{ record.answer }}
          </a-typography-text>
        </template>
        <template v-if="column.key === 'is_active'">
          <a-switch
            :checked="record.is_active === 1"
            :loading="togglingId === record.id"
            @change="(val: boolean) => onToggle(record, val)"
          />
        </template>
        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm title="确认删除此条 FAQ？" ok-text="删除" ok-type="danger" @confirm="onDelete(record.id)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 新增/编辑弹窗 -->
    <a-modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑 FAQ' : '新增 FAQ'"
      :confirm-loading="saving"
      ok-text="保存"
      @ok="handleSave"
      @cancel="resetForm"
      width="640px"
    >
      <a-form layout="vertical" style="margin-top:8px">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="分类" required>
              <a-select v-model:value="form.category" placeholder="请选择分类">
                <a-select-option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="6">
            <a-form-item label="语言">
              <a-select v-model:value="form.lang">
                <a-select-option value="zh">中文</a-select-option>
                <a-select-option value="en">English</a-select-option>
                <a-select-option value="tl">Filipino</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="6">
            <a-form-item label="排序">
              <a-input-number v-model:value="form.sort_order" :min="0" style="width:100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="问题" required>
          <a-input v-model:value="form.question" placeholder="用户可能问的问题" :maxlength="512" show-count />
        </a-form-item>
        <a-form-item label="答案" required>
          <a-textarea
            v-model:value="form.answer"
            :rows="5"
            placeholder="AI 将根据此答案回复用户"
            :maxlength="2000"
            show-count
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { getFaqList, createFaq, updateFaq, deleteFaq, type FaqItem } from '../api.js'

const CATEGORIES = [
  { value: 'deposit',  label: '充值',   color: 'blue' },
  { value: 'withdraw', label: '提款',   color: 'orange' },
  { value: 'account',  label: '账号',   color: 'purple' },
  { value: 'kyc',      label: 'KYC',    color: 'cyan' },
  { value: 'game',     label: '游戏',   color: 'green' },
  { value: 'bonus',    label: '奖金',   color: 'gold' },
  { value: 'other',    label: '其他',   color: 'default' },
]

function categoryLabel(val: string) {
  return CATEGORIES.find(c => c.value === val)?.label ?? val
}
function categoryColor(val: string) {
  return CATEGORIES.find(c => c.value === val)?.color ?? 'default'
}

const keyword = ref('')
const categoryFilter = ref<string | undefined>()
const loading = ref(false)
const items = ref<FaqItem[]>([])
const total = ref(0)
const page = ref(1)
const togglingId = ref<number | null>(null)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (t: number) => `共 ${t} 条`,
}))

const columns = [
  { title: '分类', key: 'category', width: 100 },
  { title: '问题', dataIndex: 'question', key: 'question', ellipsis: true },
  { title: '答案', key: 'answer' },
  { title: '语言', dataIndex: 'lang', key: 'lang', width: 70 },
  { title: '排序', dataIndex: 'sort_order', key: 'sort_order', width: 70 },
  { title: '启用', key: 'is_active', width: 80 },
  { title: '操作', key: 'actions', width: 130 },
]

function onPageChange(p: { current: number }) {
  load(p.current)
}

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await getFaqList({
      page: p, pageSize: 20,
      keyword: keyword.value || undefined,
      category: categoryFilter.value,
    })
    items.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function onToggle(record: FaqItem, val: boolean) {
  togglingId.value = record.id
  try {
    await updateFaq(record.id, { is_active: val ? 1 : 0 })
    record.is_active = val ? 1 : 0
    message.success(val ? '已启用' : '已禁用')
  } catch {
    message.error('操作失败')
  } finally {
    togglingId.value = null
  }
}

async function onDelete(id: number) {
  try {
    await deleteFaq(id)
    message.success('已删除')
    load(page.value)
  } catch {
    message.error('删除失败')
  }
}

// ─── 弹窗表单 ─────────────────────────────────────────────────────────────────

const modalOpen = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({
  category: 'deposit',
  question: '',
  answer: '',
  lang: 'zh',
  sort_order: 0,
})

function openCreate() {
  editingId.value = null
  Object.assign(form, { category: 'deposit', question: '', answer: '', lang: 'zh', sort_order: 0 })
  modalOpen.value = true
}

function openEdit(record: FaqItem) {
  editingId.value = record.id
  Object.assign(form, {
    category: record.category,
    question: record.question,
    answer: record.answer,
    lang: record.lang,
    sort_order: record.sort_order,
  })
  modalOpen.value = true
}

function resetForm() {
  modalOpen.value = false
  editingId.value = null
}

async function handleSave() {
  if (!form.category || !form.question.trim() || !form.answer.trim()) {
    message.warning('分类、问题、答案均为必填'); return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await updateFaq(editingId.value, { ...form })
      message.success('已保存')
    } else {
      await createFaq({ ...form })
      message.success('已新增')
    }
    modalOpen.value = false
    load(editingId.value ? page.value : 1)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => load())
</script>
