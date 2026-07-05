import { GoogleGenerativeAI, type Content } from '@google/generative-ai'
import type { Env } from '../../config/env.js'
import { getOrCreateConversation, getMessages, saveMessage } from './cs-store.js'
import { GEMINI_TOOLS, executeTool } from './cs-tools.js'
import { SYSTEM_PROMPT } from './cs-prompt.js'

const MODEL = 'gemini-2.5-flash'
const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 5

function getClient(env: Env) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')
  return new GoogleGenerativeAI(env.GEMINI_API_KEY)
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
): Promise<{ reply: string; conversationId: number; status: string }> {
  const conversation = await getOrCreateConversation(env, userId)
  const conversationId = conversation.id

  if (conversation.status === 'human_taken') {
    await saveMessage(env, conversationId, 'user', userText)
    return {
      reply: '您的问题已转接给人工客服，请稍等，客服人员将尽快回复您。',
      conversationId,
      status: 'human_taken',
    }
  }

  await saveMessage(env, conversationId, 'user', userText)

  const history = await getMessages(env, conversationId, MAX_HISTORY)
  // 去掉最后一条（刚刚存入的 user 消息，sendMessage 会单独发）
  const historyContents = buildHistory(history.slice(0, -1))

  const model = getClient(env).getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: GEMINI_TOOLS,
  })

  const chat = model.startChat({ history: historyContents })
  // hint 只发给模型,不入库不展示
  const modelText = hint ? `${userText}\n\n[System note: ${hint}]` : userText
  let response = await chat.sendMessage(modelText)

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const candidate = response.response.candidates?.[0]
    const parts = candidate?.content?.parts ?? []

    const fnCalls = parts.filter((p) => p.functionCall)

    if (fnCalls.length === 0) {
      const reply = response.response.text()
      await saveMessage(env, conversationId, 'assistant', reply)
      return { reply, conversationId, status: conversation.status }
    }

    // 执行所有工具，批量回传结果
    const toolResults = await Promise.all(
      fnCalls.map(async (p) => {
        const fn = p.functionCall!
        const result = await executeTool(env, fn.name, fn.args as Record<string, unknown>, {
          userId,
          conversationId,
        })
        return { functionResponse: { name: fn.name, response: { result } } }
      }),
    )

    response = await chat.sendMessage(toolResults)
  }

  const fallback = '抱歉，我暂时无法处理您的请求，已为您转接人工客服。'
  await saveMessage(env, conversationId, 'assistant', fallback)
  return { reply: fallback, conversationId, status: conversation.status }
}
