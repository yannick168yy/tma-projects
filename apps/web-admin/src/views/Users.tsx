import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Tag, Button, Popconfirm, Dropdown, DatePicker, InputNumber, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { SorterResult, SortOrder } from 'antd/es/table/interface'
import dayjs, { type Dayjs } from 'dayjs'
import { getUsers, updateUserStatus, updateUserLabel, getAdChannelCodes, fmtCurrencyAmounts, platformMeta, type AdminUser } from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'
import { loadListState, saveListState } from '../listState'

function labelText(l: string) {
  return ({ normal: '普通', arbitrage: '套利客', test: '测试' } as Record<string, string>)[l] ?? l
}

// 后端排序字段 -> antd sorter key
const SORT_FIELD_MAP: Record<string, string> = {
  lastLoginAt: 'lastLoginAt', balance: 'balance', depositAmount: 'depositAmount', withdrawAmount: 'withdrawAmount', id: 'id',
}

interface UsersQuery {
  search: string
  status?: string
  channel?: string
  platform?: string
  dateFrom?: string
  dateTo?: string
  minDeposit: number | null
  minWithdraw: number | null
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_QUERY: UsersQuery = {
  search: '', minDeposit: null, minWithdraw: null, page: 1, pageSize: DEFAULT_PAGE_SIZE,
}

export default function Users() {
  const navigate = useNavigate()
  const [query, setQuery] = useState<UsersQuery>(() => loadListState('users', DEFAULT_QUERY))
  // 输入框类筛选先存草稿，回车/点筛选才并入 query 触发查询
  const [search, setSearch] = useState(query.search)
  const [minDeposit, setMinDeposit] = useState<number | null>(query.minDeposit)
  const [minWithdraw, setMinWithdraw] = useState<number | null>(query.minWithdraw)
  const [channelOptions, setChannelOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [opUid, setOpUid] = useState<string | null>(null)

  const dateRange: [Dayjs | null, Dayjs | null] | null = query.dateFrom || query.dateTo
    ? [query.dateFrom ? dayjs(query.dateFrom) : null, query.dateTo ? dayjs(query.dateTo) : null]
    : null

  // 改筛选一律回第 1 页
  const patchQuery = (patch: Partial<UsersQuery>) => setQuery((q) => ({ ...q, page: 1, ...patch }))
  const applyInputs = () => patchQuery({ search, minDeposit, minWithdraw })

  useEffect(() => {
    saveListState('users', query)
    let stale = false
    setLoading(true)
    getUsers({
      page: query.page, pageSize: query.pageSize,
      search: query.search || undefined, status: query.status, channel: query.channel, platform: query.platform,
      dateFrom: query.dateFrom, dateTo: query.dateTo,
      minDeposit: query.minDeposit ?? undefined,
      minWithdraw: query.minWithdraw ?? undefined,
      sortBy: query.sortBy, sortOrder: query.sortOrder,
    }).then((res) => {
      if (stale) return
      setUsers(res.items)
      setTotal(res.total)
    }).finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [query])

  useEffect(() => { getAdChannelCodes().then(setChannelOptions).catch(() => {}) }, [])

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

  const sortOrderProp = (key: string): SortOrder => query.sortBy === key ? (query.sortOrder === 'asc' ? 'ascend' : 'descend') : null

  const columns: ColumnsType<AdminUser> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100, sorter: true, sortOrder: sortOrderProp('id') },
    { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
    { title: '等级', key: 'level', width: 70, render: (_: unknown, r: AdminUser) => <Tag color={r.level === 6 ? 'gold' : 'blue'}>LV{r.level}</Tag> },
    { title: '余额', key: 'balance', width: 100, sorter: true, sortOrder: sortOrderProp('balance'), render: (_: unknown, r: AdminUser) => `₱${Number(r.balance).toFixed(2)}` },
    {
      title: '充值金额', key: 'depositAmount', width: 150, sorter: true, sortOrder: sortOrderProp('depositAmount'),
      render: (_: unknown, r: AdminUser) => {
        const detail = fmtCurrencyAmounts(r.depositByCurrency)
        return (
          <span style={{ color: Number(r.depositAmount) > 0 ? '#389e0d' : '#bbb' }}>
            ₱{Number(r.depositAmount).toFixed(2)}
            {detail && <span style={{ color: '#888', fontSize: 11 }}> ({detail})</span>}
          </span>
        )
      },
    },
    {
      title: '取款金额', key: 'withdrawAmount', width: 150, sorter: true, sortOrder: sortOrderProp('withdrawAmount'),
      render: (_: unknown, r: AdminUser) => {
        const detail = fmtCurrencyAmounts(r.withdrawByCurrency)
        return (
          <span style={{ color: Number(r.withdrawAmount) > 0 ? '#cf1322' : '#bbb' }}>
            ₱{Number(r.withdrawAmount).toFixed(2)}
            {detail && <span style={{ color: '#888', fontSize: 11 }}> ({detail})</span>}
          </span>
        )
      },
    },
    { title: '标记', key: 'label', width: 90, render: (_: unknown, r: AdminUser) => <Tag color={r.label === 'arbitrage' ? 'red' : r.label === 'test' ? 'blue' : 'default'}>{labelText(r.label)}</Tag> },
    { title: '投放渠道', dataIndex: 'channelCode', key: 'channelCode', width: 100, render: (v: string | null) => v ? <Tag color="geekblue">{v}</Tag> : <span style={{ color: '#bbb' }}>自然量</span> },
    { title: '客户端', dataIndex: 'lastPlatform', key: 'lastPlatform', width: 90, render: (v: string | null) => { const m = platformMeta(v); return v ? <Tag color={m.color}>{m.text}</Tag> : <span style={{ color: '#bbb' }}>-</span> } },
    { title: '注册区域', dataIndex: 'registerRegion', key: 'registerRegion', width: 120, render: (v: string | null) => v || '-' },
    {
      title: '最后登录', key: 'lastLoginAt', width: 160, sorter: true, sortOrder: sortOrderProp('lastLoginAt'),
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
            { key: 'test', label: '测试', onClick: () => doLabel(r, 'test') },
          ]}}>
            <Button type="link" size="small">标记▾</Button>
          </Dropdown>
        </Space>
      ),
    },
  ]

  const pagination: TablePaginationConfig = {
    current: query.page, pageSize: query.pageSize, total,
    showTotal: (t) => `共 ${t} 条`,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  }

  function onTableChange(pg: TablePaginationConfig, _f: unknown, sorter: SorterResult<AdminUser> | SorterResult<AdminUser>[]) {
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    const key = s?.order ? SORT_FIELD_MAP[String(s.field ?? s.columnKey ?? '')] : undefined
    const order = s?.order === 'ascend' ? 'asc' : s?.order === 'descend' ? 'desc' : undefined
    setQuery((q) => ({ ...q, sortBy: key, sortOrder: order, page: pg.current ?? 1, pageSize: pg.pageSize ?? q.pageSize }))
  }

  return (
    <div>
      <h2>用户管理</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          value={search}
          placeholder="搜索用户名/邮箱/ID"
          style={{ width: 220 }}
          allowClear
          onChange={(e) => setSearch(e.target.value)}
          onSearch={applyInputs}
        />
        <DatePicker.RangePicker
          value={dateRange as [Dayjs, Dayjs] | null}
          placeholder={['注册起', '注册止']}
          onChange={(v) => patchQuery({ dateFrom: v?.[0]?.format('YYYY-MM-DD'), dateTo: v?.[1]?.format('YYYY-MM-DD') })}
          presets={[
            { label: '今天', value: [dayjs(), dayjs()] },
            { label: '近7天', value: [dayjs().add(-6, 'd'), dayjs()] },
            { label: '近30天', value: [dayjs().add(-29, 'd'), dayjs()] },
          ]}
        />
        <Select
          value={query.status}
          placeholder="状态"
          allowClear
          style={{ width: 110 }}
          onChange={(v) => patchQuery({ status: v })}
          options={[
            { value: 'active', label: '活跃' },
            { value: 'frozen', label: '冻结' },
            { value: 'banned', label: '封禁' },
          ]}
        />
        <Select
          value={query.channel}
          placeholder="投放渠道"
          allowClear showSearch
          style={{ width: 150 }}
          onChange={(v) => patchQuery({ channel: v })}
          options={[
            { value: 'organic', label: '自然量（无归因）' },
            ...channelOptions.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Select
          value={query.platform}
          placeholder="客户端"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => patchQuery({ platform: v })}
          options={[
            { value: 'web', label: '🌐 网页' },
            { value: 'app', label: '📱 App' },
            { value: 'pwa', label: '⚡ PWA' },
            { value: 'telegram', label: '✈️ Telegram' },
          ]}
        />
        <InputNumber
          value={minDeposit}
          placeholder="充值≥(₱)"
          min={0} style={{ width: 130 }}
          onChange={(v) => setMinDeposit(v)}
          onPressEnter={applyInputs}
        />
        <InputNumber
          value={minWithdraw}
          placeholder="取款≥(₱)"
          min={0} style={{ width: 130 }}
          onChange={(v) => setMinWithdraw(v)}
          onPressEnter={applyInputs}
        />
        <Button type="primary" onClick={applyInputs}>筛选</Button>
      </Space>
      <Table
        columns={columns}
        dataSource={users}
        loading={loading}
        pagination={pagination}
        onChange={onTableChange}
        rowKey="id"
        size="small"
        scroll={{ x: 'max-content' }}
      />
    </div>
  )
}
