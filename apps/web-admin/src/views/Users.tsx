import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Tag, Button, Popconfirm, Dropdown, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getUsers, updateUserStatus, updateUserLabel, type AdminUser } from '../api'

function statusColor(s: string) {
  return ({ active: 'green', frozen: 'orange', banned: 'red' } as Record<string, string>)[s] ?? 'default'
}
function statusLabel(s: string) {
  return ({ active: '活跃', frozen: '冻结', banned: '封禁' } as Record<string, string>)[s] ?? s
}
function labelText(l: string) {
  return ({ normal: '普通', arbitrage: '套利客' } as Record<string, string>)[l] ?? l
}

export default function Users() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [opUid, setOpUid] = useState<string | null>(null)

  async function load(p = 1) {
    setPage(p)
    setLoading(true)
    try {
      const res = await getUsers({ page: p, pageSize: 20, search: search || undefined, status: statusFilter })
      setUsers(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function doDisable(record: AdminUser) {
    setOpUid(record.id)
    try {
      await updateUserStatus(record.id, 'frozen')
      setUsers(prev => prev.map(u => u.id === record.id ? { ...u, status: 'frozen' } : u))
      message.success('已禁用')
    } catch { message.error('操作失败') }
    finally { setOpUid(null) }
  }

  async function doRestore(record: AdminUser) {
    setOpUid(record.id)
    try {
      await updateUserStatus(record.id, 'active')
      setUsers(prev => prev.map(u => u.id === record.id ? { ...u, status: 'active' } : u))
      message.success('已恢复')
    } catch { message.error('操作失败') }
    finally { setOpUid(null) }
  }

  async function doLabel(record: AdminUser, label: string) {
    try {
      await updateUserLabel(record.id, label)
      setUsers(prev => prev.map(u => u.id === record.id ? { ...u, label } : u))
      message.success(`已标记为：${labelText(label)}`)
    } catch { message.error('操作失败') }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
    { title: '等级', key: 'level', width: 70, render: (_: unknown, r: AdminUser) => <Tag color={r.level === 6 ? 'gold' : 'blue'}>LV{r.level}</Tag> },
    { title: 'TG用户名', dataIndex: 'telegramUsername', key: 'tg', render: (v: string | null) => v || '-' },
    { title: '余额', key: 'balance', width: 100, render: (_: unknown, r: AdminUser) => `₱${Number(r.balance).toFixed(2)}` },
    { title: '状态', key: 'status', width: 80, render: (_: unknown, r: AdminUser) => <Tag color={statusColor(r.status)}>{statusLabel(r.status)}</Tag> },
    { title: '标记', key: 'label', width: 90, render: (_: unknown, r: AdminUser) => <Tag color={r.label === 'arbitrage' ? 'red' : 'default'}>{labelText(r.label)}</Tag> },
    { title: '注册区域', dataIndex: 'registerRegion', key: 'registerRegion', width: 120, render: (v: string | null) => v || '-' },
    {
      title: '最后登录', key: 'lastLoginAt', width: 160,
      render: (_: unknown, r: AdminUser) => (
        <div>
          <div>{r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('zh-CN') : '-'}</div>
          {r.lastLoginRegion && <div style={{ color: '#999', fontSize: 11 }}>{r.lastLoginRegion}</div>}
        </div>
      ),
    },
    {
      title: '操作', key: 'actions', width: 200,
      render: (_: unknown, r: AdminUser) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => navigate(`/users/${r.id}`)}>详情</Button>
          {r.status === 'active' && (
            <Popconfirm title="确定禁用该用户？" okText="禁用" cancelText="取消" onConfirm={() => doDisable(r)}>
              <Button type="link" size="small" danger loading={opUid === r.id}>禁用</Button>
            </Popconfirm>
          )}
          {(r.status === 'frozen' || r.status === 'banned') && (
            <Popconfirm title="确定恢复该用户？" okText="恢复" cancelText="取消" onConfirm={() => doRestore(r)}>
              <Button type="link" size="small" loading={opUid === r.id}>恢复</Button>
            </Popconfirm>
          )}
          <Dropdown menu={{ items: [
            { key: 'normal', label: '普通', onClick: () => doLabel(r, 'normal') },
            { key: 'arbitrage', label: '套利客', danger: true, onClick: () => doLabel(r, 'arbitrage') },
          ]}}>
            <Button type="link" size="small">标记▾</Button>
          </Dropdown>
        </Space>
      ),
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize: 20, total,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <h2>用户管理</h2>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          value={search}
          placeholder="搜索用户名/邮箱/ID"
          style={{ width: 260 }}
          allowClear
          onChange={(e) => setSearch(e.target.value)}
          onSearch={() => load(1)}
        />
        <Select
          value={statusFilter}
          placeholder="状态"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => { setStatusFilter(v); void load(1) }}
          options={[
            { value: 'active', label: '活跃' },
            { value: 'frozen', label: '冻结' },
            { value: 'banned', label: '封禁' },
          ]}
        />
      </Space>
      <Table columns={columns} dataSource={users} loading={loading} pagination={pagination} rowKey="id" size="small" />
    </div>
  )
}
