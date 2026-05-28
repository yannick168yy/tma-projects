<template>
  <div style="display:flex; gap:16px; height:calc(100vh - 112px)">
    <!-- 左侧会话列表 -->
    <a-card style="width:340px; flex-shrink:0; overflow:auto" :body-style="{ padding: '8px 0' }">
      <template #title>
        <span>客服会话</span>
        <a-badge :count="unreadCount" style="margin-left:8px" />
      </template>
      <template #extra>
        <a-select v-model:value="statusFilter" size="small" style="width:110px" @change="loadList(1)">
          <a-select-option value="">全部</a-select-option>
          <a-select-option value="active">AI 处理中</a-select-option>
          <a-select-option value="human_taken">待人工</a-select-option>
          <a-select-option value="resolved">已解决</a-select-option>
        </a-select>
      </template>

      <div v-for="conv in conversations" :key="conv.id"
        :class="['conv-item', { active: selectedId === conv.id }]"
        @click="selectConv(conv.id)">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <span style="font-weight:600; font-size:13px">{{ conv.displayName || `用户#${conv.userId}` }}</span>
          <a-tag :color="statusColor(conv.status)" style="margin:0; font-size:11px">{{ statusText(conv.status) }}</a-tag>
        </div>
        <div style="color:#999; font-size:12px; margin-top:2px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis">
          {{ conv.lastMessage || '（暂无消息）' }}
        </div>
        <div style="color:#bbb; font-size:11px; margin-top:2px">{{ formatTime(conv.updatedAt) }}</div>
      </div>

      <a-empty v-if="!loading && conversations.length === 0" description="暂无会话" style="padding:32px 0" />
      <div v-if="conversations.length < total" style="text-align:center; padding:8px">
        <a-button type="link" size="small" :loading="loading" @click="loadMore">加载更多</a-button>
      </div>
    </a-card>

    <!-- 右侧聊天区 -->
    <a-card v-if="selectedId" style="flex:1; display:flex; flex-direction:column; overflow:hidden"
      :body-style="{ flex:1, display:'flex', flexDirection:'column', padding:'12px', overflow:'hidden' }">
      <template #title>
        <span>{{ selectedConv?.displayName || `用户#${selectedConv?.userId}` }}</span>
        <a-tag :color="statusColor(selectedConv?.status)" style="margin-left:8px">{{ statusText(selectedConv?.status) }}</a-tag>
      </template>
      <template #extra>
        <a-space>
          <a-button v-if="selectedConv?.status === 'active'" size="small" @click="takeover">接管会话</a-button>
          <a-button v-if="selectedConv?.status !== 'resolved' && selectedConv?.status !== 'closed'"
            size="small" type="primary" ghost @click="resolve">结单</a-button>
          <a-button size="small" @click="refreshDetail" :loading="detailLoading">刷新</a-button>
        </a-space>
      </template>

      <!-- 消息列表 -->
      <div ref="msgList" style="flex:1; overflow-y:auto; padding:4px 0">
        <div v-for="msg in messages" :key="msg.id" :class="['msg-row', msg.role]">
          <div class="bubble">
            <div class="role-label">
              {{ msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '🤖 AI' : '👤 客服' }}
            </div>
            <div style="white-space:pre-wrap">{{ msg.content }}</div>
            <div class="msg-time">{{ formatTime(msg.createdAt) }}</div>
          </div>
        </div>
        <a-empty v-if="messages.length === 0" description="暂无消息" />
      </div>

      <!-- 回复框 -->
      <div v-if="selectedConv?.status !== 'resolved' && selectedConv?.status !== 'closed'"
        style="margin-top:8px; display:flex; gap:8px">
        <a-textarea
          v-model:value="replyText"
          :auto-size="{ minRows: 2, maxRows: 4 }"
          placeholder="输入回复内容，Ctrl+Enter 发送"
          style="flex:1"
          @keydown.ctrl.enter="sendReply"
        />
        <a-button type="primary" :loading="replying" @click="sendReply" style="height:auto">发送</a-button>
      </div>
    </a-card>

    <a-empty v-else description="选择一个会话开始处理" style="margin:auto" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import type { CsConversation, CsMessage } from '../api.js'
import { getCsConversations, getCsConversation, csReply, csTakeover, csResolve } from '../api.js'

const conversations = ref<CsConversation[]>([])
const total = ref(0)
const loading = ref(false)
const statusFilter = ref('human_taken')
const page = ref(1)

const selectedId = ref<number | null>(null)
const selectedConv = computed(() => conversations.value.find((c) => c.id === selectedId.value) ?? null)
const messages = ref<CsMessage[]>([])
const detailLoading = ref(false)
const replyText = ref('')
const replying = ref(false)
const msgList = ref<HTMLElement | null>(null)

const unreadCount = computed(() => conversations.value.filter((c) => c.status === 'human_taken').length)

async function loadList(p = 1) {
  loading.value = true
  try {
    const res = await getCsConversations({ status: statusFilter.value || undefined, page: p, pageSize: 30 })
    if (p === 1) conversations.value = res.items
    else conversations.value.push(...res.items)
    total.value = res.total
    page.value = p
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  await loadList(page.value + 1)
}

async function selectConv(id: number) {
  selectedId.value = id
  await refreshDetail()
}

async function refreshDetail() {
  if (!selectedId.value) return
  detailLoading.value = true
  try {
    const res = await getCsConversation(selectedId.value)
    messages.value = res.messages
    const idx = conversations.value.findIndex((c) => c.id === selectedId.value)
    if (idx >= 0) conversations.value[idx] = { ...conversations.value[idx], ...res.conversation }
    await nextTick()
    if (msgList.value) msgList.value.scrollTop = msgList.value.scrollHeight
  } finally {
    detailLoading.value = false
  }
}

async function sendReply() {
  if (!replyText.value.trim() || !selectedId.value) return
  replying.value = true
  try {
    const msg = await csReply(selectedId.value, replyText.value.trim())
    messages.value.push(msg)
    replyText.value = ''
    await nextTick()
    if (msgList.value) msgList.value.scrollTop = msgList.value.scrollHeight
    // 刷新列表中这条会话的最后消息
    const idx = conversations.value.findIndex((c) => c.id === selectedId.value)
    if (idx >= 0) conversations.value[idx].lastMessage = msg.content
  } catch (e) {
    message.error(e instanceof Error ? e.message : '发送失败')
  } finally {
    replying.value = false
  }
}

async function takeover() {
  if (!selectedId.value) return
  await csTakeover(selectedId.value)
  message.success('已接管会话')
  await refreshDetail()
  await loadList(1)
}

async function resolve() {
  if (!selectedId.value) return
  await csResolve(selectedId.value)
  message.success('会话已结单')
  selectedId.value = null
  messages.value = []
  await loadList(1)
}

function statusColor(status?: string) {
  return { active: 'blue', human_taken: 'orange', resolved: 'green', closed: 'default' }[status ?? ''] ?? 'default'
}

function statusText(status?: string) {
  return { active: 'AI处理', human_taken: '待人工', resolved: '已解决', closed: '已关闭' }[status ?? ''] ?? status
}

function formatTime(t?: string) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  loadList(1)
  timer = setInterval(() => {
    loadList(1)
    if (selectedId.value) refreshDetail()
  }, 15_000)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.conv-item {
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.15s;
}
.conv-item:hover { background: #f5f5f5; }
.conv-item.active { background: #e6f4ff; }

.msg-row { display: flex; margin-bottom: 12px; }
.msg-row.user { justify-content: flex-start; }
.msg-row.assistant, .msg-row.admin { justify-content: flex-end; }

.bubble {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.msg-row.user .bubble { background: #f0f0f0; }
.msg-row.assistant .bubble { background: #e6f4ff; }
.msg-row.admin .bubble { background: #f6ffed; }

.role-label { font-size: 11px; color: #999; margin-bottom: 2px; }
.msg-time { font-size: 11px; color: #bbb; margin-top: 4px; text-align: right; }
</style>
