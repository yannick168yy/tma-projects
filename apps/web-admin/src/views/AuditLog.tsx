import { useEffect, useState } from 'react'
import { Table, Tooltip, Button } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getAuditLog, type AuditEntry } from '../api'

export default function AuditLog() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AuditEntry[]>([])
  const [page, setPage] = useState(1)

  async function load(p = 1) {
    setPage(p); setLoading(true)
    try {
      const res = await getAuditLog({ page: p, pageSize: 50 })
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
    current: page, pageSize: 50,
    total: items.length >= 50 ? page * 50 + 1 : (page - 1) * 50 + items.length,
    showTotal: () => `第 ${page} 页`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <h2>操作日志</h2>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />
    </div>
  )
}
