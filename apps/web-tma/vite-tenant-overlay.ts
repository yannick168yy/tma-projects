import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const SRC = fileURLToPath(new URL('./src', import.meta.url))
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json', '.webp', '.png', '.svg']

/**
 * L3 overlay：按租户覆盖同名文件（P3-4）。
 *
 * 用法：`src/tenants/<code>/views/HomeContent.tsx` 覆盖 `src/views/HomeContent.tsx`，
 * 构建时 `TENANT=<code> npm run build`。没有同名文件的模块照走主干，
 * 所以一个 overlay 租户只需要放它真正要改的那几个文件。
 *
 * 🔴 为什么用「同名覆盖」而不是在主干里写 if (tenant === 'xxx')：
 * 后者会让主干代码随客户数线性变脏，且每个分支都要跟着主干一起回归。
 * 同名覆盖的代价换到了另一头 —— overlay 文件不会自动跟上主干改动，
 * 所以主干改了被覆盖的文件时必须回归对应租户（见 docs/ops/tenant-overlay.md）。
 *
 * 只覆盖 `@/` 开头的内部引用：node_modules 与相对路径不参与，
 * 否则一个 overlay 里的相对 import 会被解析回主干目录，出现同一模块两份实例。
 */
export function tenantOverlay(tenant: string | undefined): Plugin {
  const overlayRoot = tenant ? join(SRC, 'tenants', tenant) : ''
  const enabled = Boolean(tenant) && existsSync(overlayRoot)
  const hits = new Set<string>()

  return {
    name: 'tenant-overlay',
    enforce: 'pre',

    configResolved() {
      if (!tenant) return
      if (!enabled) {
        throw new Error(`[tenant-overlay] TENANT=${tenant} 但 src/tenants/${tenant}/ 不存在 —— ` +
          '拼错租户代号会静默出一份主干产物，那比构建失败难查得多')
      }
    },

    async resolveId(source, importer) {
      if (!enabled) return null

      // overlay 文件内部的相对引用：先在 overlay 目录里找，找不到再回主干同位置。
      // 不这样处理的话，overlay 里 `./Foo` 会指向 overlay 目录里不存在的文件而报错
      if (source.startsWith('.') && importer?.startsWith(overlayRoot)) {
        const abs = resolve(dirname(importer), source)
        const found = probe(abs)
        if (found) return found
        const mirrored = abs.replace(overlayRoot, SRC)
        return probe(mirrored) ?? null
      }

      // Vite 的 alias 插件排在所有 pre 插件之前，所以这里拿到的多半已经是
      // 展开后的绝对路径（/…/src/xxx），而不是 `@/xxx`。两种都要认。
      const rel = source.startsWith('@/')
        ? source.slice(2)
        : source.startsWith(SRC + '/') ? source.slice(SRC.length + 1) : null
      if (rel === null || rel.startsWith('tenants/')) return null
      const candidate = probe(join(overlayRoot, rel))
      if (!candidate) return null
      hits.add(rel)
      return candidate
    },

    buildEnd() {
      if (!enabled) return
      // 构建日志里必须能看到「这次覆盖了哪几个文件」：
      // overlay 悄悄失效（改了路径/改了文件名）时，产物看起来是好的
      this.info(`[tenant-overlay] ${tenant} 覆盖 ${hits.size} 个模块：${[...hits].sort().join(', ') || '（无）'}`)
    },
  }
}

/** 补全扩展名与 index 文件，规则与 Vite 默认解析一致 */
function probe(base: string): string | null {
  if (extname(base) && existsSync(base)) return base
  for (const ext of EXTS) {
    if (existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTS) {
    const idx = join(base, `index${ext}`)
    if (existsSync(idx)) return idx
  }
  return null
}
