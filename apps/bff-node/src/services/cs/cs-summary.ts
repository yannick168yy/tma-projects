import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Env } from '../../config/env.js'
import type { CsMessage } from './cs-store.js'

const CS_SUMMARY_MODEL = 'gemini-2.5-flash-lite'
const MAX_SUMMARY_MESSAGES = 80
const MAX_MESSAGE_CHARS = 1000

function roleLabel(role: CsMessage['role']): string {
  if (role === 'user') return '用户'
  if (role === 'assistant') return 'AI客服'
  return '人工客服'
}

export async function summarizeCsConversation(
  env: Env,
  messages: CsMessage[],
): Promise<{ summary: string; model: string; messageCount: number }> {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini API is not configured')

  const summaryMessages = messages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .slice(-MAX_SUMMARY_MESSAGES)

  if (summaryMessages.length === 0) {
    return { summary: '暂无用户与AI客服对话可总结。', model: CS_SUMMARY_MODEL, messageCount: 0 }
  }

  const transcript = summaryMessages
    .map((msg) => {
      const content = msg.content.length > MAX_MESSAGE_CHARS
        ? `${msg.content.slice(0, MAX_MESSAGE_CHARS)}...`
        : msg.content
      return `${roleLabel(msg.role)}：${content}`
    })
    .join('\n')

  const prompt = `你是在线博彩平台后台客服助手。请阅读下面用户与AI客服的对话，用中文给人工客服做一个简短总结。

要求：
- 最多120个中文字符。
- 说明用户主要问题、AI已经回复/查询到的信息、建议人工下一步。
- 不要编造对话里没有的信息。
- 不要输出客套话。

对话：
${transcript}`

  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({ model: CS_SUMMARY_MODEL })
  const result = await model.generateContent([{ text: prompt }])
  const summary = result.response.text().trim()
  return { summary: summary || '信息不足，无法总结。', model: CS_SUMMARY_MODEL, messageCount: summaryMessages.length }
}
