import { GoogleGenerativeAI, type Content, type FunctionCall } from '@google/generative-ai'
import type { Env } from '../../config/env.js'
import { getOrCreateConversation, getConversationById, getMessages, saveMessage, escalateConversation } from './cs-store.js'
import { GEMINI_TOOLS, executeTool } from './cs-tools.js'
import { getSystemPrompt } from './cs-prompt.js'
import { isHumanOnDuty } from './cs-duty.js'
import { detectQuickIntent, detectLang, buildQuickReply } from './cs-quick-reply.js'
import type { CsReplyLocale } from './cs-deterministic.js'

const MODEL = 'gemini-2.5-flash'
const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 5

// 硬规则:命中即要求模型立即转人工;模型没照做时代码层兜底强转
const HARD_ESCALATION_RE =
  /human agent|real person|live agent|talk to (a |an )?(human|person|agent|someone)|speak to (a |an )?(human|person|agent)|人工客服|转人工|要人工|complaint|refund|scam|estafa|reklamo/i

function getClient(env: Env) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')
  return new GoogleGenerativeAI(env.GEMINI_API_KEY)
}

function serviceText(locale: CsReplyLocale) {
  return {
    humanHandling: {
      en: 'A human agent is handling this conversation and will reply here shortly. Please wait a moment.',
      'zh-CN': '人工客服正在处理本次会话，请稍等，客服会在这里回复你。',
      id: 'Agen manusia sedang menangani percakapan ini dan akan segera membalas di sini. Mohon tunggu sebentar.',
      vi: 'Nhân viên hỗ trợ đang xử lý cuộc trò chuyện này và sẽ phản hồi tại đây. Vui lòng chờ một chút.',
    }[locale],
    escalatedOnline: {
      en: 'Sorry, I could not resolve this myself. I have escalated it to a human agent who will reply here shortly.',
      'zh-CN': '抱歉，我无法直接解决这个问题，已为你转人工客服，客服会尽快在这里回复。',
      id: 'Maaf, saya tidak bisa menyelesaikan ini sendiri. Saya sudah meneruskannya ke agen manusia yang akan segera membalas di sini.',
      vi: 'Xin lỗi, tôi không thể tự xử lý vấn đề này. Tôi đã chuyển cho nhân viên hỗ trợ và họ sẽ sớm phản hồi tại đây.',
    }[locale],
    escalatedOffline(conversationId: number) {
      return ({
        en: `Sorry, I could not resolve this myself. I have recorded it as ticket #${conversationId} - no agent is online right now, but one will follow up in this chat as soon as available.`,
        'zh-CN': `抱歉，我无法直接解决这个问题。已记录为工单 #${conversationId}，当前没有人工客服在线，客服上线后会在这里跟进。`,
        id: `Maaf, saya tidak bisa menyelesaikan ini sendiri. Saya sudah mencatatnya sebagai tiket #${conversationId}. Saat ini tidak ada agen online, tetapi agen akan menindaklanjuti di chat ini saat tersedia.`,
        vi: `Xin lỗi, tôi không thể tự xử lý vấn đề này. Tôi đã ghi nhận thành ticket #${conversationId}. Hiện không có nhân viên online, nhưng họ sẽ phản hồi trong chat này khi có thể.`,
      })[locale]
    },
  }
}

// Gemini 要求 history 严格交替 user/model，合并相邻同角色消息
function buildHistory(msgs: { role: string; content: string }[]): Content[] {
  const contents: Content[] = []
  for (const m of msgs) {
    const role = m.role === 'user' ? 'user' : 'model'
    const last = contents[contents.length - 1]
    if (last && last.role === role) {
      last.parts.push({ text: m.content })
    } else {
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }
  return contents
}

export async function handleUserMessage(
  env: Env,
  userId: string,
  userText: string,
  hint?: string,
  onDelta?: (text: string) => void,
  locale?: CsReplyLocale,
): Promise<{ reply: string; conversationId: number; status: string; agentName: string }> {
  const conversation = await getOrCreateConversation(env, userId)
  const conversationId = conversation.id
  const agentName = conversation.agentName
  const replyLocale = locale ?? detectLang(userText)

  if (conversation.status === 'human_taken') {
    await saveMessage(env, conversationId, 'user', userText)
    const reply = serviceText(replyLocale).humanHandling
    onDelta?.(reply)
    return { reply, conversationId, status: 'human_taken', agentName }
  }

  await saveMessage(env, conversationId, 'user', userText)

  const hardEscalation = conversation.status === 'active' && HARD_ESCALATION_RE.test(userText)

  // 前置直查:登录用户高频"查我的X状态"命中即查库秒回,不进 Gemini(hint 意图不走这里)
  if (!hint && !hardEscalation && conversation.status === 'active' && !userId.startsWith('guest:')) {
    const intent = detectQuickIntent(userText)
    if (intent) {
      const quick = await buildQuickReply(env, userId, intent, replyLocale)
      if (quick) {
        onDelta?.(quick)
        await saveMessage(env, conversationId, 'assistant', quick)
        return { reply: quick, conversationId, status: conversation.status, agentName }
      }
    }
  }

  const history = await getMessages(env, conversationId, MAX_HISTORY)
  // 去掉最后一条（刚刚存入的 user 消息，sendMessage 会单独发）
  const historyContents = buildHistory(history.slice(0, -1))
  while (historyContents[0]?.role === 'model') historyContents.shift()

  const model = getClient(env).getGenerativeModel({
    model: MODEL,
    systemInstruction: await getSystemPrompt(env, conversation.agentName),
    tools: GEMINI_TOOLS,
  })

  const chat = model.startChat({ history: historyContents })
  // hint 只发给模型,不入库不展示
  const notes: string[] = []
  if (hint) notes.push(hint)
  if (hardEscalation) {
    notes.push('The user\'s message matches hard escalation triggers (asks for a human / complaint / refund / scam). Call escalate_to_human NOW with the appropriate reason, then relay the result honestly.')
  }
  if (conversation.status === 'escalated') {
    notes.push(`This conversation is already escalated as ticket #${conversationId} and waiting for a human agent. Do NOT escalate again. Keep helping with what you can, and remind the user an agent will follow up on the recorded issue.`)
  }
  const modelText = notes.length ? `${userText}\n\n[System note: ${notes.join(' ')}]` : userText
  let next: Parameters<typeof chat.sendMessageStream>[0] = modelText

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const streamResult = await chat.sendMessageStream(next)
    let roundText = ''
    const fnCalls: FunctionCall[] = []
    for await (const chunk of streamResult.stream) {
      for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (p.text) {
          roundText += p.text
          onDelta?.(p.text)
        }
        if (p.functionCall) fnCalls.push(p.functionCall)
      }
    }

    if (fnCalls.length === 0) {
      const reply = roundText
      await saveMessage(env, conversationId, 'assistant', reply)
      // 硬规则兜底:模型没执行转人工时代码层强转,不再信任模型自觉
      if (hardEscalation) {
        const latest = await getConversationById(env, conversationId)
        if (latest?.status === 'active') {
          const onDuty = await isHumanOnDuty(env)
          await escalateConversation(env, conversationId, 'user_request', onDuty ? 'human_taken' : 'escalated')
          return { reply, conversationId, status: onDuty ? 'human_taken' : 'escalated', agentName }
        }
        return { reply, conversationId, status: latest?.status ?? conversation.status, agentName }
      }
      const latest = await getConversationById(env, conversationId)
      return { reply, conversationId, status: latest?.status ?? conversation.status, agentName }
    }

    // 执行所有工具，批量回传结果
    const toolResults = await Promise.all(
      fnCalls.map(async (fn) => {
        const result = await executeTool(env, fn.name, fn.args as Record<string, unknown>, {
          userId,
          conversationId,
        })
        return { functionResponse: { name: fn.name, response: { result } } }
      }),
    )

    next = toolResults
  }

  // 工具轮次耗尽:真正转人工(按值班状态分流),不再只说不做
  const onDuty = await isHumanOnDuty(env)
  const toStatus = onDuty ? 'human_taken' : 'escalated'
  await escalateConversation(env, conversationId, 'unresolved', toStatus)
  const fallback = onDuty
    ? serviceText(replyLocale).escalatedOnline
    : serviceText(replyLocale).escalatedOffline(conversationId)
  onDelta?.(fallback)
  await saveMessage(env, conversationId, 'assistant', fallback)
  return { reply: fallback, conversationId, status: toStatus, agentName }
}
