import { useEffect, useState } from 'react'
import { Table, Tag, Switch, Button, Space, message, Modal } from 'antd'
import { getProviderStats, toggleProviderGames, type ProviderStat } from '../../api'

export default function GameProviders() {
  const [stats, setStats] = useState<ProviderStat[]>([])
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try { setStats(await getProviderStats()) }
    catch { message.error('加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function onToggle(provider: string, isActive: boolean) {
    const stat = stats.find((s) => s.provider === provider)
    const count = stat?.total ?? 0
    Modal.confirm({
      title: `${isActive ? '启用' : '关闭'}「${provider}」全部游戏`,
      content: `将${isActive ? '启用' : '关闭'} ${count} 款游戏，确认操作？`,
      okType: isActive ? 'primary' : 'danger',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setToggling(provider)
        try {
          const res = await toggleProviderGames(provider, isActive)
          setStats((prev) => prev.map((s) => s.provider === provider ? { ...s, active: isActive ? s.total : 0 } : s))
          message.success(`已${isActive ? '启用' : '关闭'} ${res.affected} 款游戏`)
        } catch { message.error('操作失败') }
        finally { setToggling(null) }
      },
    })
  }

  const columns = [
    { title: '游戏商', dataIndex: 'provider', key: 'provider', render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '游戏总数', dataIndex: 'total', key: 'total', width: 100, render: (v: number) => <Tag>{v} 款</Tag> },
    {
      title: '已启用', key: 'active', width: 100,
      render: (_: unknown, r: ProviderStat) => <Tag color={r.active === r.total ? 'green' : r.active === 0 ? 'red' : 'orange'}>{r.active} 款</Tag>,
    },
    {
      title: '状态', key: 'status', width: 100,
      render: (_: unknown, r: ProviderStat) => r.active === r.total ? <Tag color="green">全部启用</Tag> : r.active === 0 ? <Tag color="red">全部关闭</Tag> : <Tag color="orange">部分启用</Tag>,
    },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: ProviderStat) => {
        const loading = toggling === r.provider
        return (
          <Space>
            <Switch checked={r.active > 0} loading={loading} onChange={(val) => onToggle(r.provider, val)} />
            {r.active < r.total && <Button size="small" type="primary" loading={loading} onClick={() => onToggle(r.provider, true)}>全部启用</Button>}
            {r.active > 0 && r.active < r.total && <Button size="small" danger loading={loading} onClick={() => onToggle(r.provider, false)}>全部关闭</Button>}
          </Space>
        )
      },
    },
  ]

  return <Table columns={columns} dataSource={stats} rowKey="provider" loading={loading} pagination={false} size="middle" style={{ marginTop: 12 }} />
}
