/**
 * 用 Gemini 批量翻译游戏 theme slug，写入 themeSlugPhrases.generated.ts
 *
 * 用法:
 *   GEMINI_API_KEY=xxx npm start
 *
 * 可选:
 *   THEMES_FILE=/path/to/themes.txt   每行一个 slug（默认从 repo 内 themes-all.txt）
 *   BATCH_SIZE=40
 *   DRY_RUN=1                         只分析不写文件
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenerativeAI } from '@google/generative-ai'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dir, '../..')
const WEB_TMA = join(REPO_ROOT, 'apps/web-tma')
const OUT_FILE = join(WEB_TMA, 'src/i18n/themeSlugPhrases.generated.ts')
const THEMES_FILE = process.env.THEMES_FILE ?? join(__dir, 'themes-all.txt')
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 40)
const DRY_RUN = process.env.DRY_RUN === '1'
const ANALYZE_ONLY = process.argv.includes('--analyze-only')
const RETRY_ENGLISH = process.argv.includes('--retry-english')
const MODEL = 'gemini-2.5-flash'

type Locale = 'zh-CN' | 'id' | 'vi'

interface PhraseMaps {
  zh: Record<string, string>
  id: Record<string, string>
  vi: Record<string, string>
}

interface TranslationRow {
  slug: string
  zh: string
  id: string
  vi: string
}

function loadThemes(): string[] {
  if (!existsSync(THEMES_FILE)) {
    throw new Error(`主题列表不存在: ${THEMES_FILE}`)
  }
  return [...new Set(
    readFileSync(THEMES_FILE, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  )].sort()
}

async function loadTranslateFn(): Promise<(slug: string, locale: Locale) => string> {
  const mod = await import(join(WEB_TMA, 'src/i18n/themeSlugI18n.ts'))
  return mod.translateThemeSlug as (slug: string, locale: Locale) => string
}

function englishFallback(slug: string): string {
  return slug.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function isPoorlyTranslated(slug: string, locale: Locale, translate: (s: string, l: Locale) => string): boolean {
  const tr = translate(slug, locale)
  if (tr === englishFallback(slug)) return true
  const parts = slug.toLowerCase().split(/[-_\s]+/).filter(Boolean)
  for (const p of parts) {
    const titled = p.charAt(0).toUpperCase() + p.slice(1)
    if (tr.includes(titled)) return true
  }
  return false
}

function parseExistingGenerated(): PhraseMaps {
  if (!existsSync(OUT_FILE)) {
    return { zh: {}, id: {}, vi: {} }
  }
  const src = readFileSync(OUT_FILE, 'utf8')
  const pick = (name: string): Record<string, string> => {
    const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n\\})`))
    if (!m) return {}
    // eslint-disable-next-line no-eval
    return Function(`"use strict"; return (${m[1]})`)() as Record<string, string>
  }
  return {
    zh: pick('GENERATED_PHRASE_ZH'),
    id: pick('GENERATED_PHRASE_ID'),
    vi: pick('GENERATED_PHRASE_VI'),
  }
}

function loadManualPhrases(): PhraseMaps {
  const src = readFileSync(join(WEB_TMA, 'src/i18n/themeSlugI18n.ts'), 'utf8')
  const pick = (name: string): Record<string, string> => {
    const m = src.match(new RegExp(`const ${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n\\})`))
    if (!m) return {}
    return Function(`"use strict"; return (${m[1]})`)() as Record<string, string>
  }
  return {
    zh: pick('PHRASE_ZH'),
    id: pick('PHRASE_ID'),
    vi: pick('PHRASE_VI'),
  }
}

function needsTranslation(
  slug: string,
  translate: (s: string, l: Locale) => string,
  manual: PhraseMaps,
  generated: PhraseMaps,
): boolean {
  const key = slug.toLowerCase()
  if (manual.zh[key] && manual.id[key] && manual.vi[key]) return false
  if (generated.zh[key] && generated.id[key] && generated.vi[key]) {
    if (!RETRY_ENGLISH) return false
    const en = englishFallback(slug)
    if (generated.id[key] === en || generated.vi[key] === en) return true
    return false
  }
  return (
    isPoorlyTranslated(slug, 'zh-CN', translate)
    || isPoorlyTranslated(slug, 'id', translate)
    || isPoorlyTranslated(slug, 'vi', translate)
  )
}

async function translateBatch(slugs: string[], apiKey: string, retryEnglish = false): Promise<TranslationRow[]> {
  const ai = new GoogleGenerativeAI(apiKey)
  const model = ai.getGenerativeModel({ model: MODEL })

  const idViRule = retryEnglish
    ? `- Indonesian & Vietnamese: use natural local language, not English copy
- Only keep English for fixed game terms: Teen Patti, Megaways, Las Vegas, Oktoberfest, Baccarat, Blackjack, Poker, Bingo, Roulette
- Examples: modern→Kontemporer / Hiện đại, alien→Alien / Người ngoài hành tinh, bonanza→Harta Keberuntungan / Giàu có`
    : `- Indonesian & Vietnamese: short readable labels, use spaces between words`

  const prompt = `Translate these casino slot game THEME tags (URL slugs) into display labels.

Input is English kebab-case slugs like "ancient-egypt" or "asian-fortune".
Return ONLY a valid JSON array with one object per input slug, same order.
Each object: { "slug": "<original slug>", "zh": "<Simplified Chinese>", "id": "<Indonesian>", "vi": "<Vietnamese>" }

Rules:
- These are game category/theme filters shown as small chips in a mobile app
- Chinese: concise, natural gaming UI (2-6 chars when possible for simple themes)
${idViRule}
- Keep well-known proper nouns (Teen Patti, Megaways, Las Vegas, Oktoberfest)
- Do not translate slug literally word-by-word if a natural compound exists
- Do not output markdown or explanation

Input slugs:
${JSON.stringify(slugs)}`

  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 300)}`)

  const parsed = JSON.parse(jsonMatch[0]) as TranslationRow[]
  if (!Array.isArray(parsed) || parsed.length !== slugs.length) {
    throw new Error(`Expected ${slugs.length} rows, got ${parsed?.length ?? 0}`)
  }
  return parsed.map((row, i) => ({
    slug: slugs[i],
    zh: String(row.zh ?? '').trim(),
    id: String(row.id ?? '').trim(),
    vi: String(row.vi ?? '').trim(),
  }))
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function renderMap(name: string, map: Record<string, string>): string {
  const lines = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  '${escapeStr(k)}': '${escapeStr(v)}',`)
  return `export const ${name}: Record<string, string> = {\n${lines.join('\n')}\n}`
}

function writeGeneratedFile(maps: PhraseMaps): void {
  const header = `// Auto-generated by scripts/translate-theme-slugs — do not edit manually\n\n`
  const body = [
    renderMap('GENERATED_PHRASE_ZH', maps.zh),
    '',
    renderMap('GENERATED_PHRASE_ID', maps.id),
    '',
    renderMap('GENERATED_PHRASE_VI', maps.vi),
    '',
  ].join('\n')
  writeFileSync(OUT_FILE, header + body, 'utf8')
}

async function main() {
  const themes = loadThemes()
  const translate = await loadTranslateFn()
  const manual = loadManualPhrases()
  const existing = parseExistingGenerated()

  const pending = themes.filter((slug) =>
    needsTranslation(slug, translate, manual, existing),
  )

  console.log(`主题总数: ${themes.length}`)
  console.log(`待 Gemini 翻译: ${pending.length}`)
  console.log(`已有 generated: zh=${Object.keys(existing.zh).length} id=${Object.keys(existing.id).length} vi=${Object.keys(existing.vi).length}`)

  if (ANALYZE_ONLY) {
    console.log('samples:', pending.slice(0, 30).join(', '))
    return
  }

  const merged: PhraseMaps = {
    zh: { ...existing.zh },
    id: { ...existing.id },
    vi: { ...existing.vi },
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY 未设置')

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    console.log(`[${i + 1}-${i + batch.length}/${pending.length}] translating...`)
    try {
      const rows = await translateBatch(batch, apiKey, RETRY_ENGLISH)
      for (const row of rows) {
        const key = row.slug.toLowerCase()
        if (row.zh && !RETRY_ENGLISH) merged.zh[key] = row.zh
        if (row.id) merged.id[key] = row.id
        if (row.vi) merged.vi[key] = row.vi
      }
      if (!DRY_RUN) writeGeneratedFile(merged)
    } catch (e) {
      console.error(`batch failed at ${i}:`, e)
      throw e
    }
    if (i + BATCH_SIZE < pending.length) {
      await new Promise((r) => setTimeout(r, 800))
    }
  }

  if (!DRY_RUN) {
    writeGeneratedFile(merged)
    console.log(`已写入 ${OUT_FILE}`)
    console.log(`generated entries: zh=${Object.keys(merged.zh).length} id=${Object.keys(merged.id).length} vi=${Object.keys(merged.vi).length}`)
  } else {
    console.log('DRY_RUN=1，未写文件')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
