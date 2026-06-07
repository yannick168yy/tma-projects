import { useState } from 'react'
import { Space, Button, Tabs, message } from 'antd'
import { startSyncGames, startTranslateGames, getGameJob, type AdminGameJob } from '../api'
import GameList from './games/GameList'
import GameProviders from './games/GameProviders'
import GameJobModal, { type JobModalState } from './games/GameJobModal'

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const JOB_MODAL_INIT: JobModalState = { visible: false, title: '', msg: '', total: 0, percent: 0, closable: false, status: 'active' }

export default function Games() {
  const [activeTab, setActiveTab] = useState('games')
  const [syncing, setSyncing] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [jobModal, setJobModal] = useState<JobModalState>(JOB_MODAL_INIT)

  async function pollGameJob(jobId: string, onUpdate: (j: AdminGameJob) => void): Promise<AdminGameJob> {
    for (let i = 0; i < 3600; i++) {
      const job = await getGameJob(jobId)
      onUpdate(job)
      if (job.status === 'done' || job.status === 'failed') return job
      await sleep(2000)
    }
    throw new Error('任务超时')
  }

  async function runBatchJob(kind: 'sync' | 'translate', start: () => Promise<{ jobId: string; alreadyRunning?: boolean }>) {
    const isSync = kind === 'sync'
    if (isSync) setSyncing(true); else setTranslating(true)
    setJobModal({ visible: true, title: isSync ? '同步游戏库' : 'AI 翻译游戏名', msg: '正在启动任务…', total: 0, percent: 0, closable: false, status: 'active' })
    try {
      const { jobId, alreadyRunning } = await start()
      if (alreadyRunning) message.info('已有任务在运行，继续跟踪进度')
      const final = await pollGameJob(jobId, (job) => {
        setJobModal((m) => ({ ...m, msg: job.message || '处理中…', total: job.total, percent: job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0 }))
      })
      if (final.status === 'failed') {
        setJobModal((m) => ({ ...m, status: 'exception', closable: true }))
        message.error(final.error ?? '任务失败'); return
      }
      setJobModal((m) => ({ ...m, status: 'success', closable: true }))
      if (isSync) {
        message.success(`同步完成，共 ${final.result?.synced ?? 0} 款游戏`)
        setRefreshKey((k) => k + 1)
      } else {
        const r = final.result
        const t = r?.total ?? 0
        if (t === 0) message.info('所有游戏名称已翻译，无需重复操作')
        else { message.success(`翻译完成：${r?.translated ?? 0} 款成功，${r?.errors ?? 0} 款失败（共 ${t} 款待翻译）`); setRefreshKey((k) => k + 1) }
      }
    } catch (e) {
      setJobModal((m) => ({ ...m, status: 'exception', closable: true }))
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      if (isSync) setSyncing(false); else setTranslating(false)
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <h2 style={{ margin: 0 }}>游戏管理</h2>
        <Space>
          <Button loading={translating} disabled={syncing} onClick={() => runBatchJob('translate', startTranslateGames)}>AI 翻译游戏名</Button>
          <Button type="primary" loading={syncing} disabled={translating} onClick={() => runBatchJob('sync', startSyncGames)}>同步游戏库</Button>
        </Space>
      </Space>
      <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ marginBottom: 0 }} items={[{ key: 'games', label: '游戏列表' }, { key: 'providers', label: '按厂商管理' }]} />
      {activeTab === 'games' && <GameList refreshKey={refreshKey} />}
      {activeTab === 'providers' && <GameProviders />}
      <GameJobModal state={jobModal} onClose={() => setJobModal((m) => ({ ...m, visible: false }))} />
    </div>
  )
}
