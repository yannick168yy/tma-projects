import { useState } from 'react'
import { Space, Button, Tabs, message } from 'antd'
import { startWin568SyncGames, getGameJob, type AdminGameJob } from '../api'
import GameJobModal, { type JobModalState } from './games/GameJobModal'
import Win568GameList from './games/Win568GameList'
import Win568Providers from './games/Win568Providers'

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const JOB_MODAL_INIT: JobModalState = { visible: false, title: '', msg: '', total: 0, percent: 0, closable: false, status: 'active' }

export default function Games() {
  const [activeTab, setActiveTab] = useState('win568')
  const [syncing, setSyncing] = useState(false)
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

  async function runSyncJob() {
    setSyncing(true)
    setJobModal({ visible: true, title: '同步 568Win 游戏库', msg: '正在启动任务…', total: 0, percent: 0, closable: false, status: 'active' })
    try {
      const { jobId, alreadyRunning } = await startWin568SyncGames()
      if (alreadyRunning) message.info('已有任务在运行，继续跟踪进度')
      const final = await pollGameJob(jobId, (job) => {
        setJobModal((m) => ({ ...m, msg: job.message || '处理中…', total: job.total, percent: job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0 }))
      })
      if (final.status === 'failed') {
        setJobModal((m) => ({ ...m, status: 'exception', closable: true }))
        message.error(final.error ?? '任务失败'); return
      }
      setJobModal((m) => ({ ...m, status: 'success', closable: true }))
      message.success(`同步完成，共 ${final.result?.synced ?? 0} 款游戏`)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setJobModal((m) => ({ ...m, status: 'exception', closable: true }))
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <h2 style={{ margin: 0 }}>游戏管理</h2>
        <Button type="primary" loading={syncing} onClick={runSyncJob}>同步 568Win 游戏库</Button>
      </Space>
      <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ marginBottom: 0 }} items={[
        { key: 'win568', label: '568Win 游戏' },
        { key: 'win568-providers', label: '568Win 厂商' },
      ]} />
      {activeTab === 'win568' && <Win568GameList refreshKey={refreshKey} />}
      {activeTab === 'win568-providers' && <Win568Providers />}
      <GameJobModal state={jobModal} onClose={() => setJobModal((m) => ({ ...m, visible: false }))} />
    </div>
  )
}
