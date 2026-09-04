import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ReadStream } from 'node:fs'
import { currentTenantOrNull } from '../lib/tenant-context.js'

// 备份落盘目录：容器内挂载宿主 backups 目录（见 recreate-bff-node.sh）。
// 与 scripts/daily-backup.sh 的每日 cron 产出同目录、同命名，前台统一管理。
const BACKUP_DIR = process.env.DB_BACKUP_DIR ?? '/app/data/backups'

// 命名规范：<库名>-<daily|manual|preclean|preresetseq>-YYYYMMDD-HHMMSS.sql.gz
// preclean=清库前硬前置备份，preresetseq=复位发号序列前备份，均由清库/复位脚本产出
// 用于列表过滤 + 删除/下载时的白名单校验（防路径穿越）
const NAME_RE = /^[a-z0-9_]+-(daily|manual|preclean|preresetseq)-\d{8}-\d{6}\.sql\.gz$/

/**
 * 备份必须按租户隔离到各自目录。
 *
 * 🔴 修复前这里直接用 BACKUP_DIR + process.env.MYSQL_DATABASE，
 * 结果是任一租户的 super_admin 都能备份并下载**自营站的完整数据库**
 * （用户、钱包、注单、KYC），还能删掉自营站的每日备份。实测已复现。
 *
 * 目录由 tenant.id 决定而非用户输入，天然免疫路径穿越。
 * 自营站沿用根目录，保持与 scripts/daily-backup.sh 的 cron 产出兼容。
 */
function tenantScope(): { dir: string; database: string } {
  const tenant = currentTenantOrNull()
  const fallbackDb = process.env.MYSQL_DATABASE ?? 'betogo'
  if (!tenant || tenant.selfOperated) {
    return { dir: BACKUP_DIR, database: tenant?.database ?? fallbackDb }
  }
  return { dir: join(BACKUP_DIR, `t${tenant.id}`), database: tenant.database }
}

export interface BackupInfo {
  name: string
  sizeBytes: number
  mtime: string
  type: 'daily' | 'manual' | 'preclean' | 'preresetseq'
}

function two(n: number): string { return String(n).padStart(2, '0') }
function stampNow(): string {
  const d = new Date()
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
}

export function getBackupDir(): string { return tenantScope().dir }

export async function listBackups(): Promise<BackupInfo[]> {
  const { dir } = tenantScope()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const out: BackupInfo[] = []
  for (const f of files) {
    const m = NAME_RE.exec(f)
    if (!m) continue
    try {
      const s = await stat(join(dir, f))
      if (!s.isFile()) continue
      out.push({ name: f, sizeBytes: s.size, mtime: s.mtime.toISOString(), type: m[1] as BackupInfo['type'] })
    } catch { /* 文件读取中被删，跳过 */ }
  }
  out.sort((a, b) => b.mtime.localeCompare(a.mtime))
  return out
}

// 立即备份：与每日 cron 相同的 mysqldump 参数，产出 betogo-manual-<stamp>.sql.gz。
// 不主动清理旧备份，交由每日 cron 的保留策略统一处理，避免误删用户刚手动生成的备份。
export async function createBackup(): Promise<BackupInfo> {
  const { dir, database } = tenantScope()
  await mkdir(dir, { recursive: true })
  const name = `${database}-manual-${stampNow()}.sql.gz`
  const tmp = join(dir, `${name}.part`)
  const final = join(dir, name)

  const args = [
    '--default-character-set=utf8mb4', '--single-transaction', '--quick', '--no-tablespaces',
    '-h', process.env.MYSQL_HOST ?? 'tma-mysql',
    '-P', String(process.env.MYSQL_PORT ?? 3306),
    '-u', process.env.MYSQL_USER ?? 'betogo',
    database,
  ]
  const child = spawn('mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: process.env.MYSQL_PASSWORD ?? '' },
  })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d.toString() })

  // 10 分钟兜底超时，防 mysqldump 卡死挂住请求
  const killer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000)
  try {
    const closed = new Promise<number>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })
    await pipeline(child.stdout, createGzip(), createWriteStream(tmp))
    const code = await closed
    if (code !== 0) throw new Error(`mysqldump exited ${code}: ${stderr.slice(0, 300).trim()}`)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  } finally {
    clearTimeout(killer)
  }

  const s = await stat(tmp)
  if (s.size < 100) {
    await unlink(tmp).catch(() => {})
    throw new Error('备份文件异常（体积过小）')
  }
  await rename(tmp, final)
  const fs2 = await stat(final)
  return { name, sizeBytes: fs2.size, mtime: fs2.mtime.toISOString(), type: 'manual' }
}

export async function removeBackup(name: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new Error('非法备份文件名')
  await unlink(join(tenantScope().dir, name))
}

// 供下载：校验白名单后返回可读流与体积；文件不存在则抛错
export async function openBackupForDownload(name: string): Promise<{ stream: ReadStream, sizeBytes: number }> {
  if (!NAME_RE.test(name)) throw new Error('非法备份文件名')
  const path = join(tenantScope().dir, name)
  const s = await stat(path)
  return { stream: createReadStream(path), sizeBytes: s.size }
}
