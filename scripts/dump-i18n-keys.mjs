#!/usr/bin/env node
// 导出前台英文词条为扁平 key 目录，供平台控制台的文案覆盖编辑器做搜索（P1-11）。
//
// 为什么要这个中间产物：i18n 词条定义在 apps/web-tma 里，平台控制台与 BFF 都读不到
// 它的源码。与其让 BFF 反向依赖前台源码，不如像 schema_baseline 那样产出一份显式артefact。
//
// 用法：node scripts/dump-i18n-keys.mjs
// 产物：infra/i18n/keys.en.json（{ "checkin.title": "Daily Check-in", ... }）
// 词条改动后需要重跑，否则编辑器搜不到新 key —— 只影响后台搜索，不影响前台。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'apps/web-tma/src/i18n/locales/en.ts')
const out = resolve(root, 'infra/i18n/keys.en.json')

// en.ts 是 TS 模块，直接 import 需要 ts 运行时。借用 web-tma 已有的 esbuild
// 把它转成一份临时 mjs —— 比引入新依赖或手写解析器都稳。
const require = createRequire(resolve(root, 'apps/web-tma/package.json'))
const esbuild = require('esbuild')

const { outputFiles } = await esbuild.build({
  entryPoints: [source],
  bundle: false,
  format: 'esm',
  write: false,
  loader: { '.ts': 'ts' },
})
const tmp = resolve(root, 'apps/web-tma/node_modules/.i18n-keys.mjs')
await writeFile(tmp, outputFiles[0].text)
const { default: en } = await import(pathToFileURL(tmp).href)

/** 嵌套对象 → 点号扁平键。只收字符串叶子，数组与其他类型不是可覆盖的文案 */
function flatten(node, prefix, into) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') into[path] = value
    else if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, into)
  }
  return into
}

const flat = flatten(en, '', {})
await mkdir(dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(flat, null, 2) + '\n')
console.log(`导出 ${Object.keys(flat).length} 条 key → ${out}`)
