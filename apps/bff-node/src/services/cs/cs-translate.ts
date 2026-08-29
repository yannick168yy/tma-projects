import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Env } from '../../config/env.js'
import type { CsMessage } from './cs-store.js'

const CS_TRANSLATE_MODEL = 'gemini-2.5-flash'
const MAX_TRANSLATE_MESSAGES = 100
const MAX_MESSAGE_CHARS = 2000

export interface CsTranslation {
  id: number
  translated: string
}

export type CsTranslationLanguage = 'id' | 'zh-CN'

const LANGUAGE_NAMES: Record<CsTranslationLanguage, string> = {
  id: '印尼语（Bahasa Indonesia）',
  'zh-CN': '简体中文',
}

export async function translateContent(
  env: Env,
  texts: string[],
  targetLanguage: CsTranslationLanguage = 'id',
): Promise<{ items: string[]; model: string }> {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini API is not configured')
  const targets = texts.slice(0, 20).map((text) => text.trim().slice(0, MAX_MESSAGE_CHARS))
  if (!targets.length || targets.some((text) => !text)) throw new Error('翻译原文不能为空')

  const prompt = `你是专业本地化翻译。请把下面 JSON 数组中的平台运营和客服文案翻译成${LANGUAGE_NAMES[targetLanguage]}。
保留金额、币种、网址、占位符和原有语气，不增加承诺，不解释。只返回相同长度的 JSON 字符串数组。\n\n${JSON.stringify(targets)}`
  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({
    model: CS_TRANSLATE_MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  }, { timeout: 30_000 })
  const result = await model.generateContent([{ text: prompt }])
  const parsed = JSON.parse(result.response.text().trim()) as unknown
  if (!Array.isArray(parsed) || parsed.length !== targets.length || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('翻译结果解析失败')
  }
  return { items: parsed.map((item) => String(item).trim()), model: CS_TRANSLATE_MODEL }
}

// 把整段客服对话逐条翻译成中文。已是中文的原样返回。
export async function translateCsConversation(
  env: Env,
  messages: CsMessage[],
): Promise<{ items: CsTranslation[]; model: string }> {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini API is not configured')

  const targets = messages
    .filter((msg) => msg.content.trim().length > 0)
    .slice(-MAX_TRANSLATE_MESSAGES)

  if (targets.length === 0) {
    return { items: [], model: CS_TRANSLATE_MODEL }
  }

  const payload = targets.map((msg, i) => ({
    i,
    t: msg.content.length > MAX_MESSAGE_CHARS ? `${msg.content.slice(0, MAX_MESSAGE_CHARS)}...` : msg.content,
  }))

  const prompt = `你是专业翻译。下面是一段在线博彩平台客服对话的 JSON 数组，每项有 i(序号) 和 t(原文)。
请把每条 t 翻译成简体中文，保留原意与语气，不要增删信息、不要解释。
如果某条本来已经是中文，就原样返回。
只返回一个 JSON 数组，每项格式为 {"i": 序号, "t": "中文译文"}，不要输出任何其他内容。

输入：
${JSON.stringify(payload)}`

  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({
    model: CS_TRANSLATE_MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  }, { timeout: 30_000 })
  const result = await model.generateContent([{ text: prompt }])
  const raw = result.response.text().trim()

  let parsed: Array<{ i: number; t: string }>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('翻译结果解析失败')
  }

  const byIndex = new Map<number, string>()
  for (const row of parsed) {
    if (typeof row?.i === 'number' && typeof row?.t === 'string') byIndex.set(row.i, row.t)
  }

  const items = targets.map((msg, i) => ({
    id: msg.id,
    translated: byIndex.get(i)?.trim() || msg.content,
  }))

  return { items, model: CS_TRANSLATE_MODEL }
}
