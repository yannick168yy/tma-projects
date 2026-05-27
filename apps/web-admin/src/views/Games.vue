<template>
  <div>
    <h2>游戏管理</h2>
    <a-space style="margin-bottom:16px" wrap>
      <a-input-search
        v-model:value="search"
        placeholder="搜索游戏名称"
        style="width:220px"
        @search="load(1)"
        allow-clear
      />
      <a-select v-model:value="providerFilter" placeholder="游戏商" allow-clear style="width:180px" @change="load(1)">
        <a-select-option v-for="p in providers" :key="p" :value="p">{{ p }}</a-select-option>
      </a-select>
      <a-select v-model:value="activeFilter" placeholder="状态" allow-clear style="width:120px" @change="load(1)">
        <a-select-option value="true">已启用</a-select-option>
        <a-select-option value="false">已禁用</a-select-option>
      </a-select>
      <a-tag>共 {{ total }} 款游戏</a-tag>
    </a-space>

    <a-table
      :columns="columns"
      :data-source="games"
      :loading="loading"
      :pagination="pagination"
      row-key="uuid"
      size="small"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <a-space>
            <img v-if="record.imageUrl" :src="record.imageUrl" style="width:32px;height:32px;object-fit:cover;border-radius:4px" />
            <span>{{ record.name }}</span>
          </a-space>
        </template>
        <template v-if="column.key === 'tags'">
          <a-tag v-if="record.hasDemo" color="blue">Demo</a-tag>
          <a-tag v-if="record.isMobile" color="green">Mobile</a-tag>
        </template>
        <template v-if="column.key === 'isActive'">
          <a-switch
            :checked="record.isActive"
            :loading="togglingUuid === record.uuid"
            @change="(val: boolean) => onToggle(record, val)"
          />
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { getAdminGames, toggleGame, type AdminGame } from '../api.js'

const search = ref('')
const providerFilter = ref<string | undefined>()
const activeFilter = ref<string | undefined>()
const loading = ref(false)
const games = ref<AdminGame[]>([])
const providers = ref<string[]>([])
const total = ref(0)
const page = ref(1)
const togglingUuid = ref<string | null>(null)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (t: number) => `共 ${t} 款`,
}))

function onPageChange(p: { current: number }) {
  load(p.current)
}

const columns = [
  { title: '游戏名称', key: 'name', ellipsis: true },
  { title: '游戏商', dataIndex: 'provider', key: 'provider', width: 160 },
  { title: '分类', dataIndex: 'category', key: 'category', width: 100 },
  { title: '标签', key: 'tags', width: 120 },
  { title: '启用', key: 'isActive', width: 80 },
]

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const isActive = activeFilter.value !== undefined ? activeFilter.value === 'true' : undefined
    const res = await getAdminGames({
      page: p, pageSize: 20,
      provider: providerFilter.value,
      search: search.value || undefined,
      isActive,
    })
    games.value = res.items
    total.value = res.total
    if (res.providers.length) providers.value = res.providers
  } finally {
    loading.value = false
  }
}

async function onToggle(record: AdminGame, val: boolean) {
  togglingUuid.value = record.uuid
  try {
    await toggleGame(record.uuid, val)
    record.isActive = val
    message.success(val ? '已启用' : '已禁用')
  } catch {
    message.error('操作失败')
  } finally {
    togglingUuid.value = null
  }
}

onMounted(() => load())
</script>
