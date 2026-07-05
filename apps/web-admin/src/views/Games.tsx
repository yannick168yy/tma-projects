import { useState } from 'react'
import { Space, Button, Tabs, message } from 'antd'
import { startSyncGames, startTranslateGames, startWin568SyncGames, getGameJob, type AdminGameJob } from '../api'
import GameList from './games/GameList'
import GameProviders from './games/GameProviders'
import GameJobModal, { type JobModalState } from './games/GameJobModal'
import Win568GameList from './games/Win568GameList'
import Win568Providers from './games/Win568Providers'

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const JOB_MODAL_INIT: JobModalState = { visible: false, title: '', msg: '', total: 0, percent: 0, closable: false, status: 'active' }

export default function Games() {
  const [activeTab, setActiveTab] = useState('win568')
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

  async function runBatchJob(kind: 'sync' | 'translate' | 'win568-sync', start: () => Promise<{ jobId: string; alreadyRunning?: boolean }>) {
    const isTranslate = kind === 'translate'
    const isWin568 = kind === 'win568-sync'
    if (isTranslate) setTranslating(true); else setSyncing(true)
    setJobModal({ visible: true, title: isTranslate ? 'AI 翻译游戏名' : isWin568 ? '同步 568Win 游戏库' : '同步 Slotegrator 游戏库', msg: '正在启动任务…', total: 0, percent: 0, closable: false, status: 'active' })
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
      if (!isTranslate) {
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
      if (isTranslate) setTranslating(false); else setSyncing(false)
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <h2 style={{ margin: 0 }}>游戏管理</h2>
        <Space>
          <Button loading={translating} disabled={syncing} onClick={() => runBatchJob('translate', startTranslateGames)}>AI 翻译游戏名</Button>
          <Button loading={syncing} disabled={translating} onClick={() => runBatchJob('sync', startSyncGames)}>同步 SG 游戏库</Button>
          <Button type="primary" loading={syncing} disabled={translating} onClick={() => runBatchJob('win568-sync', startWin568SyncGames)}>同步 568Win 游戏库</Button>
        </Space>
      </Space>
      <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ marginBottom: 0 }} items={[
        { key: 'win568', label: '568Win 游戏' },
        { key: 'win568-providers', label: '568Win 厂商' },
        { key: 'games', label: 'SG 历史游戏' },
        { key: 'providers', label: 'SG 厂商' },
      ]} />
      {activeTab === 'win568' && <Win568GameList refreshKey={refreshKey} />}
      {activeTab === 'win568-providers' && <Win568Providers />}
      {activeTab === 'games' && <GameList refreshKey={refreshKey} />}
      {activeTab === 'providers' && <GameProviders />}
      <GameJobModal state={jobModal} onClose={() => setJobModal((m) => ({ ...m, visible: false }))} />
    </div>
  )
}
