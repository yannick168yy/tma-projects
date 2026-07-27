import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Tag, Button, Popconfirm, Dropdown, DatePicker, InputNumber, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { SorterResult, SortOrder } from 'antd/es/table/interface'
import dayjs, { type Dayjs } from 'dayjs'
import { getUsers, updateUserStatus, updateUserLabel, getAdChannelCodes, fmtCurrencyAmounts, type AdminUser } from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

function statusColor(s: string) {
  return ({ active: 'green', frozen: 'orange', banned: 'red' } as Record<string, string>)[s] ?? 'default'
}
function statusLabel(s: string) {
  return ({ active: '活跃', frozen: '冻结', banned: '封禁' } as Record<string, string>)[s] ?? s
}
function labelText(l: string) {
  return ({ normal: '普通', arbitrage: '套利客', test: '测试' } as Record<string, string>)[l] ?? l
}

// 后端排序字段 -> antd sorter key
const SORT_FIELD_MAP: Record<string, string> = {
  lastLoginAt: 'lastLoginAt', balance: 'balance', depositAmount: 'depositAmount', withdrawAmount: 'withdrawAmount', id: 'id',
}

export default function Users() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [channelFilter, setChannelFilter] = useState<string | undefined>()
  const [channelOptions, setChannelOptions] = useState<string[]>([])
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [minDeposit, setMinDeposit] = useState<number | null>(null)
  const [minWithdraw, setMinWithdraw] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<string | undefined>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [opUid, setOpUid] = useState<string | null>(null)

  async function load(p = 1, ps = pageSize, sBy = sortBy, sOrder = sortOrder) {
    setPage(p)
    setPageSize(ps)
    setLoading(true)
    try {
      const res = await getUsers({
        page: p, pageSize: ps,
        search: search || undefined, status: statusFilter, channel: channelFilter,
        dateFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
        dateTo: dateRange?.[1]?.format('YYYY-MM-DD'),
        minDeposit: minDeposit ?? undefined,
        minWithdraw: minWithdraw ?? undefined,
        sortBy: sBy, sortOrder: sOrder,
      })
      setUsers(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
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

  const sortOrderProp = (key: string): SortOrder => sortBy === key ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null

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
    { title: '状态', key: 'status', width: 80, render: (_: unknown, r: AdminUser) => <Tag color={statusColor(r.status)}>{statusLabel(r.status)}</Tag> },
    { title: '标记', key: 'label', width: 90, render: (_: unknown, r: AdminUser) => <Tag color={r.label === 'arbitrage' ? 'red' : r.label === 'test' ? 'blue' : 'default'}>{labelText(r.label)}</Tag> },
    { title: '投放渠道', dataIndex: 'channelCode', key: 'channelCode', width: 100, render: (v: string | null) => v ? <Tag color="geekblue">{v}</Tag> : <span style={{ color: '#bbb' }}>自然量</span> },
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
    current: page, pageSize, total,
    showTotal: (t) => `共 ${t} 条`,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  }

  function onTableChange(pg: TablePaginationConfig, _f: unknown, sorter: SorterResult<AdminUser> | SorterResult<AdminUser>[]) {
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    const key = s?.order ? SORT_FIELD_MAP[String(s.field ?? s.columnKey ?? '')] : undefined
    const order = s?.order === 'ascend' ? 'asc' : s?.order === 'descend' ? 'desc' : undefined
    setSortBy(key)
    setSortOrder(order)
    void load(pg.current ?? 1, pg.pageSize ?? pageSize, key, order)
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
          onSearch={() => load(1)}
        />
        <DatePicker.RangePicker
          value={dateRange as [Dayjs, Dayjs] | null}
          placeholder={['注册起', '注册止']}
          onChange={(v) => { setDateRange(v as [Dayjs | null, Dayjs | null] | null); void load(1) }}
          presets={[
            { label: '今天', value: [dayjs(), dayjs()] },
            { label: '近7天', value: [dayjs().add(-6, 'd'), dayjs()] },
            { label: '近30天', value: [dayjs().add(-29, 'd'), dayjs()] },
          ]}
        />
        <Select
          value={statusFilter}
          placeholder="状态"
          allowClear
          style={{ width: 110 }}
          onChange={(v) => { setStatusFilter(v); void load(1) }}
          options={[
            { value: 'active', label: '活跃' },
            { value: 'frozen', label: '冻结' },
            { value: 'banned', label: '封禁' },
          ]}
        />
        <Select
          value={channelFilter}
          placeholder="投放渠道"
          allowClear showSearch
          style={{ width: 150 }}
          onChange={(v) => { setChannelFilter(v); void load(1) }}
          options={[
            { value: 'organic', label: '自然量（无归因）' },
            ...channelOptions.map((c) => ({ value: c, label: c })),
          ]}
        />
        <InputNumber
          value={minDeposit}
          placeholder="充值≥(₱)"
          min={0} style={{ width: 130 }}
          onChange={(v) => setMinDeposit(v)}
          onPressEnter={() => load(1)}
        />
        <InputNumber
          value={minWithdraw}
          placeholder="取款≥(₱)"
          min={0} style={{ width: 130 }}
          onChange={(v) => setMinWithdraw(v)}
          onPressEnter={() => load(1)}
        />
        <Button type="primary" onClick={() => load(1)}>筛选</Button>
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
