import Router from '@koa/router'
import { writeAuditLog } from '../../services/admin-store.js'
import { ok, fail } from '../../utils/response.js'
import { requireRole } from '../../middleware/require-role.js'
import { listBackups, createBackup, removeBackup, openBackupForDownload, getBackupDir } from '../../services/db-backup.service.js'

const router = new Router({ prefix: '/db-backup' })

const onlySuper = requireRole('super_admin', '仅超级管理员可管理数据库备份')

// 列表：备份目录、每日保留份数、所有备份文件
router.get('/', onlySuper, async (ctx) => {
  const items = await listBackups()
  ok(ctx, { dir: getBackupDir(), keep: 14, items })
})

// 立即备份（同步等待 mysqldump 完成，初期库小仅数秒）
router.post('/', onlySuper, async (ctx) => {
  try {
    const info = await createBackup()
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
      action: 'db_backup_create', targetType: 'db_backup', targetId: info.name,
      detail: { sizeBytes: info.sizeBytes }, ip: ctx.ip,
    })
    ok(ctx, info)
  } catch (e) {
    fail(ctx, 500, `备份失败：${(e as Error).message}`)
  }
})

// 下载指定备份（文件名走 query param，避免以 .gz 结尾的路径被 nginx 当静态文件拦截）
router.get('/download', onlySuper, async (ctx) => {
  const name = String(ctx.query.name ?? '')
  try {
    const { stream, sizeBytes } = await openBackupForDownload(name)
    ctx.set('Content-Type', 'application/gzip')
    ctx.set('Content-Disposition', `attachment; filename="${name}"`)
    ctx.set('Content-Length', String(sizeBytes))
    ctx.body = stream
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
      action: 'db_backup_download', targetType: 'db_backup', targetId: name, ip: ctx.ip,
    })
  } catch (e) {
    fail(ctx, 404, `找不到备份：${(e as Error).message}`)
  }
})

// 删除指定备份（同理，文件名走 query param）
router.delete('/', onlySuper, async (ctx) => {
  const name = String(ctx.query.name ?? '')
  try {
    await removeBackup(name)
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
      action: 'db_backup_delete', targetType: 'db_backup', targetId: name, ip: ctx.ip,
    })
    ok(ctx, { name })
  } catch (e) {
    fail(ctx, 400, `删除失败：${(e as Error).message}`)
  }
})

export default router
