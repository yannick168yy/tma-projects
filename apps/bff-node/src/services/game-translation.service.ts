import { GoogleGenerativeAI } from '@google/generative-ai'
import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'

const MODEL = 'gemini-2.5-flash'
const BATCH_SIZE = 30

interface Translation {
  id: string
  vi: string
  zh: string
}

async function translateBatch(names: string[], env: Env): Promise<Translation[]> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')
  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({ model: MODEL })

  const prompt = `Translate these casino/slot game names from English to Indonesian (id), Vietnamese (vi), and Simplified Chinese (zh).

Return ONLY a valid JSON array. Each element must have keys "id", "vi", "zh" in the same order as the input names.
Rules:
- Keep proper nouns and brand identifiers natural (e.g. "Dragon Tiger", "Fortune Ox")
- Chinese translations should sound natural in a gaming/gambling context
- Be concise — game names are short
- Do not output anything outside the JSON array

Input names:
${JSON.stringify(names)}`

  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()

  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error(`No JSON array in Gemini response: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(jsonMatch[0]) as Translation[]
  if (!Array.isArray(parsed) || parsed.length !== names.length) {
    throw new Error(`Expected ${names.length} translations, got ${parsed.length}`)
  }
  return parsed
}

export async function translateUntranslatedGames(
  env: Env,
): Promise<{ translated: number; errors: number; total: number }> {
  const db = getMysqlPool(env)

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT uuid, name FROM sg_games
     WHERE name_id IS NULL OR name_vi IS NULL OR name_zh IS NULL
     ORDER BY weight DESC, uuid`,
  )

  const total = rows.length
  let translated = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = (rows as RowDataPacket[]).slice(i, i + BATCH_SIZE)
    const names = batch.map((r) => String(r.name))

    try {
      const translations = await translateBatch(names, env)
      for (let j = 0; j < batch.length; j++) {
        const t = translations[j]
        await db.execute(
          `UPDATE sg_games SET name_id = ?, name_vi = ?, name_zh = ? WHERE uuid = ?`,
          [t.id?.trim() || null, t.vi?.trim() || null, t.zh?.trim() || null, batch[j].uuid],
        )
        translated++
      }
      console.log(`[game-translation] batch ${i + 1}–${i + batch.length} / ${total} done`)
    } catch (e) {
      console.error(`[game-translation] batch ${i}–${i + BATCH_SIZE} failed:`, e)
      errors += batch.length
    }

    if (i + BATCH_SIZE < rows.length) {
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
  }

  return { translated, errors, total }
}
