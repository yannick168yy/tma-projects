<template>
  <div>
    <a-space style="margin-bottom:12px;width:100%;justify-content:space-between" align="center">
      <h2 style="margin:0">游戏管理</h2>
      <a-space>
        <a-button :loading="translating" :disabled="syncing" @click="doTranslate">AI 翻译游戏名</a-button>
        <a-button type="primary" :loading="syncing" :disabled="translating" @click="doSync">同步游戏库</a-button>
      </a-space>
    </a-space>

    <!-- 筛选栏 -->
    <div style="background:#fafafa;border:1px solid #f0f0f0;border-radius:6px;padding:12px 16px;margin-bottom:14px">
      <a-row :gutter="[8, 8]">
        <a-col :span="5">
          <a-input-search v-model:value="search" placeholder="搜索游戏名/关键词" @search="load(1)" allow-clear />
        </a-col>
        <a-col :span="4">
          <a-select v-model:value="providerFilter" placeholder="游戏商" allow-clear style="width:100%" @change="load(1)">
            <a-select-option v-for="p in providers" :key="p" :value="p">{{ p }}</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="sortCategoryFilter" placeholder="前端分类" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="slots">Slots</a-select-option>
            <a-select-option value="fishing">Fishing</a-select-option>
            <a-select-option value="live">Live</a-select-option>
            <a-select-option value="bingo">Bingo</a-select-option>
            <a-select-option value="crash">Crash</a-select-option>
            <a-select-option value="table">Table</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="themeFilter" placeholder="游戏主题" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="fishing">fishing</a-select-option>
            <a-select-option value="asian">asian</a-select-option>
            <a-select-option value="mythology">mythology</a-select-option>
            <a-select-option value="fantasy">fantasy</a-select-option>
            <a-select-option value="adventure">adventure</a-select-option>
            <a-select-option value="fruit">fruit</a-select-option>
            <a-select-option value="classic">classic</a-select-option>
            <a-select-option value="animal">animal</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="gameStyleFilter" placeholder="游戏风格" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="asian">asian</a-select-option>
            <a-select-option value="western">western</a-select-option>
            <a-select-option value="classic">classic</a-select-option>
            <a-select-option value="modern">modern</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="playerTypeFilter" placeholder="适合玩家" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="casual">casual 休闲</a-select-option>
            <a-select-option value="regular">regular 普通</a-select-option>
            <a-select-option value="high-roller">high-roller 高额</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="weightRangeFilter" placeholder="权重分段" allow-clear style="width:100%" @change="onWeightRangeChange">
            <a-select-option value="80-100">高热度 80-100</a-select-option>
            <a-select-option value="50-79">中热度 50-79</a-select-option>
            <a-select-option value="1-49">低热度 1-49</a-select-option>
            <a-select-option value="0-0">未评分 0</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="volatilityFilter" placeholder="波动性" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="low">低 Low</a-select-option>
            <a-select-option value="medium">中 Medium</a-select-option>
            <a-select-option value="high">高 High</a-select-option>
            <a-select-option value="very-high">极高 Very High</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="demoFilter" placeholder="支持试玩" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="true">支持试玩</a-select-option>
            <a-select-option value="false">不支持</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="featuredFilter" placeholder="推荐首页" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="true">已推荐</a-select-option>
            <a-select-option value="false">未推荐</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="techFilter" placeholder="技术" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="HTML5">HTML5</a-select-option>
            <a-select-option value="Flash">Flash</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3">
          <a-select v-model:value="activeFilter" placeholder="状态" allow-clear style="width:100%" @change="load(1)">
            <a-select-option value="true">已启用</a-select-option>
            <a-select-option value="false">已禁用</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="3" style="display:flex;align-items:center;gap:8px">
          <a-tag color="blue">共 {{ total }} 款</a-tag>
          <a-button size="small" @click="resetFilters">重置</a-button>
        </a-col>
      </a-row>
    </div>

    <a-table
      :columns="columns"
      :data-source="games"
      :loading="loading"
      :pagination="pagination"
      row-key="uuid"
      size="small"
      :scroll="{ x: 1400 }"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <!-- 游戏名 -->
        <template v-if="column.key === 'name'">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <img
              v-if="record.imageHqUrl || record.imageUrl"
              :src="record.imageHqUrl || record.imageUrl"
              style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;margin-top:2px"
            />
            <div style="min-width:0">
              <div style="font-weight:500;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                {{ record.name }}
              </div>
              <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:2px">
                <a-tag v-if="record.isFeatured" color="gold" style="font-size:10px;padding:0 3px;line-height:16px;margin:0">推荐</a-tag>
                <a-tag v-if="record.hasDemo" color="blue" style="font-size:10px;padding:0 3px;line-height:16px;margin:0">Demo</a-tag>
                <a-tag v-if="record.isMobile" color="green" style="font-size:10px;padding:0 3px;line-height:16px;margin:0">手机</a-tag>
              </div>
            </div>
          </div>
        </template>

        <!-- 游戏商 -->
        <template v-if="column.key === 'provider'">
          <div style="font-size:13px">{{ record.provider }}</div>
          <div v-if="record.label" style="font-size:11px;color:#888;margin-top:1px">{{ record.label }}</div>
          <a-tag v-if="record.technology" :color="record.technology === 'HTML5' ? 'blue' : 'orange'"
            style="font-size:10px;padding:0 4px;margin-top:2px">{{ record.technology }}</a-tag>
        </template>

        <!-- 前端分类 -->
        <template v-if="column.key === 'sortCategory'">
          <a-tag v-if="record.sortCategory" :color="sortCategoryColor(record.sortCategory)"
            style="font-size:11px;margin-bottom:2px">{{ record.sortCategory }}</a-tag>
          <div v-else style="color:#ccc;font-size:12px">—</div>
          <div style="font-size:11px;color:#aaa">{{ record.type || record.category || '' }}</div>
        </template>

        <!-- 主题/风格/玩家 -->
        <template v-if="column.key === 'aiAttrs'">
          <div v-if="record.theme" style="font-size:11px;color:#595959">
            <span style="color:#999">主题:</span> {{ record.theme }}
          </div>
          <div v-if="record.gameStyle" style="font-size:11px;color:#595959;margin-top:1px">
            <span style="color:#999">风格:</span> {{ record.gameStyle }}
          </div>
          <div v-if="record.playerType" style="font-size:11px;margin-top:1px">
            <a-tag :color="playerTypeColor(record.playerType)" style="font-size:10px;padding:0 4px">{{ record.playerType }}</a-tag>
          </div>
          <div v-if="!record.theme && !record.gameStyle && !record.playerType" style="color:#ccc;font-size:12px">—</div>
        </template>

        <!-- 参数 -->
        <template v-if="column.key === 'params'">
          <div v-if="record.rtp != null" style="font-size:12px">RTP <b>{{ record.rtp }}%</b></div>
          <a-tag v-if="record.volatility" :color="volatilityColor(record.volatility)"
            style="font-size:10px;padding:0 4px;margin-top:2px">{{ record.volatility }}</a-tag>
          <div v-if="record.reelsCount || record.linesCount" style="font-size:10px;color:#aaa;margin-top:2px">
            <span v-if="record.reelsCount">{{ record.reelsCount }}轮</span>
            <span v-if="record.reelsCount && record.linesCount"> · </span>
            <span v-if="record.linesCount">{{ record.linesCount }}线</span>
          </div>
        </template>

        <!-- 权重长条 -->
        <template v-if="column.key === 'weight'">
          <div v-if="record.weight > 0" style="display:flex;align-items:center;gap:4px">
            <a-progress
              type="line"
              :percent="record.weight"
              :stroke-width="8"
              :stroke-color="weightColor(record.weight)"
              :show-info="false"
              style="flex:1;min-width:50px;margin:0"
            />
            <span style="font-size:11px;color:#595959;width:22px;text-align:right;flex-shrink:0">{{ record.weight }}</span>
          </div>
          <span v-else style="color:#d9d9d9;font-size:11px">未评</span>
        </template>

        <!-- PH热度 -->
        <template v-if="column.key === 'phBonus'">
          <span v-if="record.phBonus > 0" style="font-size:13px;font-weight:600;color:#1677ff">{{ record.phBonus }}</span>
          <span v-else style="color:#d9d9d9;font-size:11px">—</span>
          <span v-if="record.phBonus > 0" style="font-size:10px;color:#999"> /30</span>
        </template>

        <!-- 特性 -->
        <template v-if="column.key === 'features'">
          <a-space wrap :size="2">
            <a-tag v-if="record.hasFreespins" color="purple" style="font-size:10px;padding:0 4px">免费旋</a-tag>
            <a-tag v-if="record.hasLobby" color="cyan" style="font-size:10px;padding:0 4px">大厅</a-tag>
            <a-tag v-if="record.hasTables" color="geekblue" style="font-size:10px;padding:0 4px">桌台</a-tag>
          </a-space>
          <div v-if="!record.hasFreespins && !record.hasLobby && !record.hasTables" style="color:#ccc;font-size:11px">—</div>
        </template>

        <!-- 操作 -->
        <template v-if="column.key === 'actions'">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
            <a-switch
              :checked="record.isActive"
              size="small"
              :loading="togglingUuid === record.uuid"
              @change="(val: boolean) => onToggle(record, val)"
            />
            <a-button type="link" size="small" style="padding:0;height:auto;font-size:11px" @click="openDetail(record)">
              详情
            </a-button>
          </div>
        </template>
      </template>
    </a-table>

    <!-- 详情弹窗 -->
    <a-modal
      v-model:open="detailVisible"
      :title="detailGame?.name"
      :footer="null"
      width="680px"
      :body-style="{ maxHeight: '75vh', overflowY: 'auto', padding: '16px 20px' }"
      destroy-on-close
    >
      <template v-if="detailGame">
        <!-- 封面图 -->
        <div v-if="detailGame.imageHqUrl || detailGame.imageUrl" style="text-align:center;margin-bottom:14px">
          <img
            :src="detailGame.imageHqUrl || detailGame.imageUrl || ''"
            style="max-width:100%;max-height:160px;object-fit:contain;border-radius:6px"
          />
        </div>

        <!-- 基本信息 -->
        <a-descriptions title="基本信息" :column="2" bordered size="small" style="margin-bottom:14px">
          <a-descriptions-item label="UUID" :span="2">
            <span style="font-size:11px;font-family:monospace;word-break:break-all">{{ detailGame.uuid }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="游戏商">
            {{ detailGame.provider }}
            <span v-if="detailGame.providerId" style="color:#999;font-size:11px"> (ID: {{ detailGame.providerId }})</span>
          </a-descriptions-item>
          <a-descriptions-item label="子标签">{{ detailGame.label || '—' }}</a-descriptions-item>
          <a-descriptions-item label="技术">
            <a-tag v-if="detailGame.technology" :color="detailGame.technology === 'HTML5' ? 'blue' : 'orange'">{{ detailGame.technology }}</a-tag>
            <span v-else>—</span>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="detailGame.isActive ? 'green' : 'red'">{{ detailGame.isActive ? '已启用' : '已禁用' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="更新时间" :span="2">
            {{ detailGame.updatedAt ? new Date(detailGame.updatedAt).toLocaleString('zh-CN') : '—' }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- 分类信息 -->
        <a-descriptions title="分类信息" :column="2" bordered size="small" style="margin-bottom:14px">
          <a-descriptions-item label="前端分类">
            <a-tag v-if="detailGame.sortCategory" :color="sortCategoryColor(detailGame.sortCategory)">{{ detailGame.sortCategory }}</a-tag>
            <span v-else>—</span>
          </a-descriptions-item>
          <a-descriptions-item label="游戏类型">{{ detailGame.type || '—' }}</a-descriptions-item>
          <a-descriptions-item label="分类">{{ detailGame.category || '—' }}</a-descriptions-item>
          <a-descriptions-item label="子分类">{{ detailGame.subCategory || '—' }}</a-descriptions-item>
          <a-descriptions-item label="游戏主题">{{ detailGame.theme || '—' }}</a-descriptions-item>
          <a-descriptions-item label="游戏风格">{{ detailGame.gameStyle || '—' }}</a-descriptions-item>
          <a-descriptions-item label="适合玩家" :span="2">
            <a-tag v-if="detailGame.playerType" :color="playerTypeColor(detailGame.playerType)">{{ detailGame.playerType }}</a-tag>
            <span v-else>—</span>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 游戏参数 -->
        <a-descriptions title="游戏参数" :column="2" bordered size="small" style="margin-bottom:14px">
          <a-descriptions-item label="RTP">{{ detailGame.rtp != null ? detailGame.rtp + '%' : '—' }}</a-descriptions-item>
          <a-descriptions-item label="波动性">
            <a-tag v-if="detailGame.volatility" :color="volatilityColor(detailGame.volatility)">{{ detailGame.volatility }}</a-tag>
            <span v-else>—</span>
          </a-descriptions-item>
          <a-descriptions-item label="转轮数">{{ detailGame.reelsCount || '—' }}</a-descriptions-item>
          <a-descriptions-item label="赔付线">{{ detailGame.linesCount ?? '—' }}</a-descriptions-item>
        </a-descriptions>

        <!-- 多语言名称 -->
        <a-descriptions title="多语言名称" :column="1" bordered size="small" style="margin-bottom:14px">
          <a-descriptions-item label="英语 (en)">{{ detailGame.name }}</a-descriptions-item>
          <a-descriptions-item label="印尼语 (id)">
            <span v-if="detailGame.nameId">{{ detailGame.nameId }}</span>
            <span v-else style="color:#bbb">未翻译</span>
          </a-descriptions-item>
          <a-descriptions-item label="越南语 (vi)">
            <span v-if="detailGame.nameVi">{{ detailGame.nameVi }}</span>
            <span v-else style="color:#bbb">未翻译</span>
          </a-descriptions-item>
          <a-descriptions-item label="中文 (zh-CN)">
            <span v-if="detailGame.nameZh">{{ detailGame.nameZh }}</span>
            <span v-else style="color:#bbb">未翻译</span>
          </a-descriptions-item>
        </a-descriptions>

        <!-- AI 富化 -->
        <a-descriptions title="AI 富化数据" :column="1" bordered size="small" style="margin-bottom:14px">
          <a-descriptions-item label="热度权重">
            <div style="display:flex;align-items:center;gap:8px">
              <a-progress type="line" :percent="detailGame.weight" :stroke-width="8"
                :stroke-color="weightColor(detailGame.weight)" :show-info="false" style="flex:1;margin:0" />
              <span style="font-size:13px;font-weight:500;width:30px">{{ detailGame.weight }}</span>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="PH热度(ph_bonus)">
            <span style="font-size:13px;font-weight:500;color:#1677ff">{{ detailGame.phBonus }}</span>
            <span style="font-size:11px;color:#999"> / 30</span>
          </a-descriptions-item>
          <a-descriptions-item label="推荐首页">
            <a-tag :color="detailGame.isFeatured ? 'gold' : 'default'">{{ detailGame.isFeatured ? '已推荐' : '未推荐' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="中文简介">
            <span style="white-space:pre-wrap">{{ detailGame.descriptionZh || '—' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="英文简介">
            <span style="white-space:pre-wrap;font-size:12px">{{ detailGame.descriptionEn || '—' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="搜索关键词">
            <span style="font-size:11px;word-break:break-all">{{ detailGame.searchKeywords || '—' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="权重更新时间">
            {{ detailGame.weightUpdatedAt ? new Date(detailGame.weightUpdatedAt).toLocaleString('zh-CN') : '—' }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- 功能特性 -->
        <a-descriptions title="功能特性" :column="2" bordered size="small" style="margin-bottom:14px">
          <a-descriptions-item label="支持试玩">
            <a-tag :color="detailGame.hasDemo ? 'blue' : 'default'">{{ detailGame.hasDemo ? '支持' : '不支持' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="手机端">
            <a-tag :color="detailGame.isMobile ? 'green' : 'default'">{{ detailGame.isMobile ? '支持' : '不支持' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="免费旋转">
            <a-tag :color="detailGame.hasFreespins ? 'purple' : 'default'">{{ detailGame.hasFreespins ? '支持' : '不支持' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="大厅模式">
            <a-tag :color="detailGame.hasLobby ? 'cyan' : 'default'">{{ detailGame.hasLobby ? '支持' : '不支持' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="桌台" :span="2">
            <a-tag :color="detailGame.hasTables ? 'geekblue' : 'default'">{{ detailGame.hasTables ? '有' : '无' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item v-if="detailGame.tags?.length" label="标签" :span="2">
            <a-tag v-for="t in detailGame.tags" :key="t" style="margin:2px">{{ t }}</a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 图片地址 -->
        <a-descriptions title="图片" :column="1" bordered size="small">
          <a-descriptions-item label="标准图">
            <a v-if="detailGame.imageUrl" :href="detailGame.imageUrl" target="_blank"
              style="font-size:11px;word-break:break-all">{{ detailGame.imageUrl }}</a>
            <span v-else style="color:#ccc">—</span>
          </a-descriptions-item>
          <a-descriptions-item label="高清图">
            <a v-if="detailGame.imageHqUrl" :href="detailGame.imageHqUrl" target="_blank"
              style="font-size:11px;word-break:break-all">{{ detailGame.imageHqUrl }}</a>
            <span v-else style="color:#ccc">—</span>
          </a-descriptions-item>
        </a-descriptions>
      </template>
    </a-modal>

    <a-modal
      v-model:open="jobModalVisible"
      :title="jobModalTitle"
      :footer="null"
      :closable="jobClosable"
      :mask-closable="false"
      width="420"
    >
      <p style="margin-bottom:12px;color:#666">{{ jobMessage }}</p>
      <a-progress
        v-if="jobTotal > 0"
        :percent="jobPercent"
        :status="jobProgressStatus"
      />
      <a-spin v-else />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  getAdminGames,
  toggleGame,
  startSyncGames,
  startTranslateGames,
  getGameJob,
  type AdminGame,
  type AdminGameJob,
} from '../api.js'

const search = ref('')
const providerFilter = ref<string | undefined>()
const sortCategoryFilter = ref<string | undefined>()
const themeFilter = ref<string | undefined>()
const gameStyleFilter = ref<string | undefined>()
const playerTypeFilter = ref<string | undefined>()
const weightRangeFilter = ref<string | undefined>()
const volatilityFilter = ref<string | undefined>()
const demoFilter = ref<string | undefined>()
const featuredFilter = ref<string | undefined>()
const techFilter = ref<string | undefined>()
const activeFilter = ref<string | undefined>()

const loading = ref(false)
const syncing = ref(false)
const translating = ref(false)
const games = ref<AdminGame[]>([])
const providers = ref<string[]>([])
const total = ref(0)
const page = ref(1)
const sortField = ref<string | undefined>()
const sortOrder = ref<'asc' | 'desc' | undefined>()
const togglingUuid = ref<string | null>(null)
const detailVisible = ref(false)
const detailGame = ref<AdminGame | null>(null)

const pagination = computed(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (t: number) => `共 ${t} 款`,
  showSizeChanger: false,
}))

function onTableChange(
  pag: { current?: number },
  _filters: unknown,
  sorter: { columnKey?: string; order?: string },
) {
  if (sorter.columnKey && sorter.order) {
    sortField.value = sorter.columnKey
    sortOrder.value = sorter.order === 'ascend' ? 'asc' : 'desc'
  } else {
    sortField.value = undefined
    sortOrder.value = undefined
  }
  load(pag.current ?? 1)
}

function volatilityColor(v: string) {
  if (v.includes('very')) return 'magenta'
  if (v.includes('high')) return 'red'
  if (v.includes('medium')) return 'orange'
  return 'green'
}

function sortCategoryColor(cat: string) {
  const map: Record<string, string> = {
    slots: 'purple', fishing: 'cyan', live: 'red',
    bingo: 'green', crash: 'orange', table: 'blue',
  }
  return map[cat] ?? 'default'
}

function playerTypeColor(pt: string) {
  if (pt === 'high-roller') return 'red'
  if (pt === 'regular') return 'blue'
  return 'green'
}

function weightColor(w: number) {
  if (w >= 80) return '#52c41a'
  if (w >= 50) return '#faad14'
  return '#1677ff'
}

function onWeightRangeChange() { load(1) }

function resetFilters() {
  search.value = ''
  providerFilter.value = undefined
  sortCategoryFilter.value = undefined
  themeFilter.value = undefined
  gameStyleFilter.value = undefined
  playerTypeFilter.value = undefined
  weightRangeFilter.value = undefined
  volatilityFilter.value = undefined
  demoFilter.value = undefined
  featuredFilter.value = undefined
  techFilter.value = undefined
  activeFilter.value = undefined
  load(1)
}

const columns = [
  { title: '游戏', key: 'name', width: 220 },
  { title: '游戏商', key: 'provider', width: 130 },
  { title: '前端分类', key: 'sortCategory', width: 100 },
  { title: '主题/风格/玩家', key: 'aiAttrs', width: 150 },
  { title: '参数', key: 'params', width: 110 },
  { title: '热度权重', key: 'weight', width: 120, sorter: true, sortDirections: ['ascend', 'descend'] },
  { title: 'PH热度', key: 'phBonus', width: 90, sorter: true, sortDirections: ['ascend', 'descend'] },
  { title: '特性', key: 'features', width: 120 },
  { title: '操作', key: 'actions', width: 65, fixed: 'right' },
]

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const isActive = activeFilter.value !== undefined ? activeFilter.value === 'true' : undefined
    const isFeatured = featuredFilter.value !== undefined ? featuredFilter.value === 'true' : undefined
    const hasDemo = demoFilter.value !== undefined ? demoFilter.value === 'true' : undefined

    let weightMin: number | undefined
    let weightMax: number | undefined
    if (weightRangeFilter.value) {
      const [mn, mx] = weightRangeFilter.value.split('-').map(Number)
      weightMin = mn
      weightMax = mx
    }

    const res = await getAdminGames({
      page: p, pageSize: 20,
      provider: providerFilter.value,
      search: search.value || undefined,
      isActive,
      sortCategory: sortCategoryFilter.value,
      volatility: volatilityFilter.value,
      isFeatured,
      hasDemo,
      theme: themeFilter.value,
      gameStyle: gameStyleFilter.value,
      playerType: playerTypeFilter.value,
      weightMin,
      weightMax,
      sortField: sortField.value,
      sortOrder: sortOrder.value,
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

function openDetail(record: AdminGame) {
  detailGame.value = record
  detailVisible.value = true
}

const jobModalVisible = ref(false)
const jobModalTitle = ref('')
const jobMessage = ref('')
const jobTotal = ref(0)
const jobPercent = ref(0)
const jobClosable = ref(false)
const jobProgressStatus = ref<'active' | 'success' | 'exception'>('active')

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function pollGameJob(
  jobId: string,
  onUpdate: (job: AdminGameJob) => void,
): Promise<AdminGameJob> {
  for (let i = 0; i < 3600; i++) {
    const job = await getGameJob(jobId)
    onUpdate(job)
    if (job.status === 'done' || job.status === 'failed') return job
    await sleep(2000)
  }
  throw new Error('任务超时，请稍后在服务端日志中确认是否已完成')
}

function applyJobUi(job: AdminGameJob) {
  jobMessage.value = job.message || '处理中…'
  jobTotal.value = job.total
  jobPercent.value = job.total > 0
    ? Math.min(100, Math.round((job.progress / job.total) * 100))
    : 0
}

async function runBatchJob(
  kind: 'sync' | 'translate',
  start: () => Promise<{ jobId: string; alreadyRunning?: boolean }>,
) {
  const isSync = kind === 'sync'
  if (isSync) syncing.value = true
  else translating.value = true

  jobModalTitle.value = isSync ? '同步游戏库' : 'AI 翻译游戏名'
  jobMessage.value = '正在启动任务…'
  jobTotal.value = 0
  jobPercent.value = 0
  jobProgressStatus.value = 'active'
  jobClosable.value = false
  jobModalVisible.value = true

  try {
    const { jobId, alreadyRunning } = await start()
    if (alreadyRunning) {
      message.info('已有任务在运行，继续跟踪进度')
    }
    const final = await pollGameJob(jobId, applyJobUi)
    if (final.status === 'failed') {
      jobProgressStatus.value = 'exception'
      message.error(final.error ?? '任务失败')
      return
    }
    jobProgressStatus.value = 'success'
    if (isSync) {
      const synced = final.result?.synced ?? 0
      message.success(`同步完成，共 ${synced} 款游戏`)
      load(1)
    } else {
      const r = final.result
      const total = r?.total ?? 0
      if (total === 0) {
        message.info('所有游戏名称已翻译，无需重复操作')
      } else {
        message.success(`翻译完成：${r?.translated ?? 0} 款成功，${r?.errors ?? 0} 款失败（共 ${total} 款待翻译）`)
        load(1)
      }
    }
  } catch (e) {
    jobProgressStatus.value = 'exception'
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    jobClosable.value = true
    if (isSync) syncing.value = false
    else translating.value = false
  }
}

async function doSync() {
  await runBatchJob('sync', startSyncGames)
}

async function doTranslate() {
  await runBatchJob('translate', startTranslateGames)
}

onMounted(load)
</script>
