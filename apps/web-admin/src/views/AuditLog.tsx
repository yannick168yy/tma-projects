import { useEffect, useState } from 'react'
import { Table, Tooltip, Button } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getAuditLog, type AuditEntry } from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

export default function AuditLog() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AuditEntry[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  async function load(p = 1, ps = pageSize) {
    setPage(p); setPageSize(ps); setLoading(true)
    try {
      const res = await getAuditLog({ page: p, pageSize: ps })
      setItems(res.items)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '操作人', dataIndex: 'adminUsername', key: 'admin' },
    { title: '动作', dataIndex: 'action', key: 'action' },
    { title: '对象类型', dataIndex: 'targetType', key: 'type', render: (v: string | null) => v ?? '-' },
    { title: '对象ID', dataIndex: 'targetId', key: 'tid', render: (v: string | null) => v ?? '-' },
    {
      title: '详情', key: 'detail',
      render: (_: unknown, r: AuditEntry) => r.detail ? (
        <Tooltip title={<pre style={{ maxWidth: 400, fontSize: 11 }}>{JSON.stringify(r.detail, null, 2)}</pre>}>
          <Button type="link" size="small">查看</Button>
        </Tooltip>
      ) : '-',
    },
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v: string | null) => v ?? '-' },
    { title: '时间', dataIndex: 'createdAt', key: 'at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize,
    total: items.length >= pageSize ? page * pageSize + 1 : (page - 1) * pageSize + items.length,
    showTotal: () => `第 ${page} 页`,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onChange: (p, ps) => load(p, ps),
  }

  return (
    <div>
      <h2>操作日志</h2>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />
    </div>
  )
}
