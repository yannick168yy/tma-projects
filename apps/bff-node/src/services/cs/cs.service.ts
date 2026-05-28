import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Env } from '../../config/env.js'
import { getOrCreateConversation, getMessages, saveMessage } from './cs-store.js'
import { CS_TOOLS, executeTool } from './cs-tools.js'
import { SYSTEM_PROMPT } from './cs-prompt.js'

const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 5

function getClient(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

export async function handleUserMessage(
  env: Env,
  userId: number,
  userText: string,
): Promise<{ reply: string; conversationId: number; status: string }> {
  const conversation = await getOrCreateConversation(env, userId)
  const conversationId = conversation.id

  // 已转人工时 AI 不介入，直接存消息等待人工回复
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
  const messages: MessageParam[] = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }))

  const client = getClient(env)
  let rounds = 0

  // agentic tool-use loop
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: CS_TOOLS,
      messages,
    })

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text')
      const reply = textBlock?.type === 'text' ? textBlock.text : '抱歉，我无法处理您的请求，请稍后再试。'
      await saveMessage(env, conversationId, 'assistant', reply)
      return { reply, conversationId, status: conversation.status }
    }

    if (response.stop_reason === 'tool_use') {
      // 把 assistant 这一轮（含 tool_use blocks）加入历史
      messages.push({ role: 'assistant', content: response.content })

      const toolResults: MessageParam['content'] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeTool(env, block.name, block.input as Record<string, unknown>, {
          userId,
          conversationId,
        })
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    break
  }

  const fallback = '抱歉，我暂时无法处理您的请求，已为您转接人工客服。'
  await saveMessage(env, conversationId, 'assistant', fallback)
  return { reply: fallback, conversationId, status: conversation.status }
}
