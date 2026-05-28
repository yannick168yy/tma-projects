<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { Send, Headphones, Loader2 } from 'lucide-vue-next'
import { sendCsMessage, fetchCsHistory } from '@/api/cs'
import type { CsMessage } from '@/api/cs'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const messages = ref<CsMessage[]>([])
const inputText = ref('')
const sending = ref(false)
const loading = ref(true)
const conversationStatus = ref('active')
const msgContainer = ref<HTMLElement | null>(null)

async function scrollToBottom() {
  await nextTick()
  if (msgContainer.value) msgContainer.value.scrollTop = msgContainer.value.scrollHeight
}

onMounted(async () => {
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  try {
    const res = await fetchCsHistory()
    messages.value = res.messages
    conversationStatus.value = res.conversation.status
  } catch {
    // 首次会话无历史，正常
  } finally {
    loading.value = false
    await scrollToBottom()
  }
})

async function send() {
  const text = inputText.value.trim()
  if (!text || sending.value) return

  if (!auth.isLoggedIn) {
    await auth.ensureLoggedIn(t('auth.signInProfile'))
    return
  }

  inputText.value = ''
  messages.value.push({
    id: Date.now(),
    conversationId: 0,
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  })
  await scrollToBottom()

  sending.value = true
  try {
    const res = await sendCsMessage(text)
    conversationStatus.value = res.status
    messages.value.push({
      id: Date.now() + 1,
      conversationId: res.conversationId,
      role: res.status === 'human_taken' ? 'admin' : 'assistant',
      content: res.reply,
      createdAt: new Date().toISOString(),
    })
    await scrollToBottom()
  } catch (e) {
    messages.value.push({
      id: Date.now() + 1,
      conversationId: 0,
      role: 'assistant',
      content: '抱歉，消息发送失败，请稍后再试。',
      createdAt: new Date().toISOString(),
    })
  } finally {
    sending.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="page-scroll hide-scrollbar flex flex-col" style="height:100%">
    <!-- 头部（safe area 适配刘海屏） -->
    <div class="app-safe-header flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-3 flex-shrink-0">
      <div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
        <Headphones :size="18" class="text-primary" />
      </div>
      <div class="flex-1">
        <p class="text-sm font-bold text-foreground">客服中心</p>
        <p class="text-xs text-muted-foreground">
          {{ conversationStatus === 'human_taken' ? '人工客服为您服务' : 'AI 智能客服' }}
        </p>
      </div>
      <button type="button" class="text-muted-foreground hover:text-foreground p-1" @click="emit('close')">
        <span class="text-lg leading-none">×</span>
      </button>
    </div>

    <!-- 消息区 -->
    <div ref="msgContainer" class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      <!-- 加载中 -->
      <div v-if="loading" class="flex justify-center py-8">
        <Loader2 :size="20" class="animate-spin text-muted-foreground" />
      </div>

      <!-- 欢迎语（登录/未登录均显示） -->
      <template v-else>
        <div v-if="messages.length === 0" class="flex justify-start">
          <div class="max-w-[85%] rounded-2xl rounded-tl-sm bg-secondary px-3.5 py-2.5">
            <p class="text-xs text-muted-foreground mb-1">🤖 AI</p>
            <p class="text-sm text-foreground">您好！我是 BetoGo 的智能客服 Kaya，很高兴为您服务。有什么可以帮到您？</p>
          </div>
        </div>

        <div v-for="msg in messages" :key="msg.id"
          :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start']">
          <div :class="[
            'max-w-[85%] rounded-2xl px-3.5 py-2.5',
            msg.role === 'user'
              ? 'rounded-tr-sm bg-primary text-primary-foreground'
              : 'rounded-tl-sm bg-secondary text-foreground'
          ]">
            <p v-if="msg.role !== 'user'" class="text-xs text-muted-foreground mb-1">
              {{ msg.role === 'assistant' ? '🤖 AI' : '👤 客服' }}
            </p>
            <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>
            <p class="text-[10px] mt-1 opacity-60 text-right">{{ formatTime(msg.createdAt) }}</p>
          </div>
        </div>

        <!-- 发送中动画 -->
        <div v-if="sending" class="flex justify-start">
          <div class="rounded-2xl rounded-tl-sm bg-secondary px-3.5 py-2.5">
            <p class="text-xs text-muted-foreground mb-1">🤖 AI</p>
            <div class="flex gap-1 items-center h-5">
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style="animation-delay:0ms" />
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style="animation-delay:150ms" />
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style="animation-delay:300ms" />
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 输入框 -->
    <div class="flex-shrink-0 border-t border-border bg-card px-3 py-2.5 flex gap-2 items-end">
      <textarea
        v-model="inputText"
        rows="1"
        placeholder="输入您的问题…"
        class="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        style="max-height:80px; overflow-y:auto"
        :disabled="sending"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
        :disabled="!inputText.trim() || sending"
        @click="send"
      >
        <Send :size="16" />
      </button>
    </div>
  </div>
</template>
