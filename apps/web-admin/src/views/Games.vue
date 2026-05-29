<template>
  <div>
    <a-space style="margin-bottom:16px;width:100%;justify-content:space-between" align="center">
      <h2 style="margin:0">游戏管理</h2>
      <a-button type="primary" :loading="syncing" @click="doSync">同步游戏库</a-button>
    </a-space>

    <a-space style="margin-bottom:16px" wrap>
      <a-input-search v-model:value="search" placeholder="搜索游戏名称" style="width:220px"
        @search="load(1)" allow-clear />
      <a-select v-model:value="providerFilter" placeholder="游戏商" allow-clear style="width:180px" @change="load(1)">
        <a-select-option v-for="p in providers" :key="p" :value="p">{{ p }}</a-select-option>
      </a-select>
      <a-select v-model:value="techFilter" placeholder="技术" allow-clear style="width:110px" @change="load(1)">
        <a-select-option value="HTML5">HTML5</a-select-option>
        <a-select-option value="Flash">Flash</a-select-option>
      </a-select>
      <a-select v-model:value="activeFilter" placeholder="状态" allow-clear style="width:110px" @change="load(1)">
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
            <img
              v-if="record.imageHqUrl || record.imageUrl"
              :src="record.imageHqUrl || record.imageUrl"
              style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0"
            />
            <div>
              <div style="font-weight:500;line-height:1.3">{{ record.name }}</div>
              <div style="font-size:11px;color:#888">{{ record.uuid }}</div>
            </div>
          </a-space>
        </template>

        <template v-if="column.key === 'provider'">
          <div>{{ record.provider }}</div>
          <div v-if="record.label" style="font-size:11px;color:#888">{{ record.label }}</div>
          <a-tag v-if="record.technology" :color="record.technology === 'HTML5' ? 'blue' : 'orange'" style="margin-top:2px">
            {{ record.technology }}
          </a-tag>
        </template>

        <template v-if="column.key === 'type'">
          <div>{{ record.type || record.category || '—' }}</div>
          <div v-if="record.subCategory" style="font-size:11px;color:#888">{{ record.subCategory }}</div>
        </template>

        <template v-if="column.key === 'params'">
          <div v-if="record.rtp != null" style="font-size:12px">
            RTP: <b>{{ record.rtp }}%</b>
          </div>
          <div v-if="record.volatility" style="font-size:12px">
            <a-tag :color="volatilityColor(record.volatility)" style="font-size:11px">
              {{ record.volatility }}
            </a-tag>
          </div>
          <div v-if="record.reelsCount || record.linesCount" style="font-size:11px;color:#888">
            <span v-if="record.reelsCount">轮{{ record.reelsCount }}</span>
            <span v-if="record.linesCount"> / {{ record.linesCount }}线</span>
          </div>
        </template>

        <template v-if="column.key === 'features'">
          <a-space wrap :size="2">
            <a-tag v-if="record.hasDemo" color="blue" style="font-size:11px">Demo</a-tag>
            <a-tag v-if="record.isMobile" color="green" style="font-size:11px">手机</a-tag>
            <a-tag v-if="record.hasFreespins" color="purple" style="font-size:11px">免费旋</a-tag>
            <a-tag v-if="record.hasLobby" color="cyan" style="font-size:11px">大厅</a-tag>
            <a-tag v-if="record.hasTables" color="geekblue" style="font-size:11px">桌台</a-tag>
          </a-space>
          <div v-if="record.tags?.length" style="margin-top:4px">
            <a-tag v-for="t in record.tags.slice(0,3)" :key="t" style="font-size:10px;margin:1px">{{ t }}</a-tag>
            <span v-if="record.tags.length > 3" style="font-size:10px;color:#888">+{{ record.tags.length - 3 }}</span>
          </div>
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
import { getAdminGames, toggleGame, syncGames, type AdminGame } from '../api.js'

const search = ref('')
const providerFilter = ref<string | undefined>()
const techFilter = ref<string | undefined>()
const activeFilter = ref<string | undefined>()
const loading = ref(false)
const syncing = ref(false)
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

function onPageChange(p: { current: number }) { load(p.current) }

function volatilityColor(v: string) {
  if (v.includes('high')) return 'red'
  if (v.includes('medium')) return 'orange'
  return 'green'
}

const columns = [
  { title: '游戏', key: 'name', ellipsis: true },
  { title: '游戏商', key: 'provider', width: 150 },
  { title: '类型', key: 'type', width: 120 },
  { title: '参数', key: 'params', width: 130 },
  { title: '特性/标签', key: 'features', width: 160 },
  { title: '启用', key: 'isActive', width: 70 },
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

async function doSync() {
  syncing.value = true
  try {
    const res = await syncGames()
    message.success(`同步完成，共 ${res.synced} 款游戏`)
    load(1)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '同步失败')
  } finally {
    syncing.value = false
  }
}

onMounted(load)
</script>
