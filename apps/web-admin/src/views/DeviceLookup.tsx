import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Table, Space, Input, Tag, Button, Alert, Card, Typography } from 'antd'
import { lookupDevice, type DeviceLookupResult } from '../api'

function statusColor(s: string) {
  return ({ active: 'green', frozen: 'orange', banned: 'red' } as Record<string, string>)[s] ?? 'default'
}
function statusLabel(s: string) {
  return ({ active: '活跃', frozen: '冻结', banned: '封禁' } as Record<string, string>)[s] ?? s
}
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '-')

export default function DeviceLookup() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const urlValue = params.get('value') || ''

  const [value, setValue] = useState(urlValue)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DeviceLookupResult | null>(null)

  // 从 URL 参数驱动查询：其他页跳转带 ?value= 时自动查出结果（field 参数已废弃，忽略）
  useEffect(() => {
    setValue(urlValue)
    if (!urlValue) { setResult(null); return }
    let alive = true
    setLoading(true)
    lookupDevice({ value: urlValue })
      .then((r) => { if (alive) setResult(r) })
      .catch(() => { if (alive) setResult(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [urlValue])

  function doSearch(v: string) {
    const val = v.trim()
    if (!val) return
    setParams({ value: val })
  }

  // 表格里的账号/IP/设备/指纹值可点击，直接对该值做全量反查
  const lookupLink = (v: string | null) =>
    v ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => doSearch(v)}>{v}</Button> : '-'

  const accountCols = [
    { title: '账号', dataIndex: 'userId', key: 'userId', width: 110, render: (v: string) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/users/${v}`)}>{v}</Button> },
    { title: '显示名', dataIndex: 'displayName', key: 'displayName', render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag color={statusColor(v)}>{statusLabel(v)}</Tag> },
    { title: '登录次数', dataIndex: 'loginCount', key: 'loginCount', width: 90 },
    { title: '首次出现', dataIndex: 'firstSeen', key: 'firstSeen', width: 160, render: fmt },
    { title: '最近出现', dataIndex: 'lastSeen', key: 'lastSeen', width: 160, render: fmt },
  ]

  const logCols = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 160, render: fmt },
    { title: '账号', dataIndex: 'userId', key: 'userId', width: 110, render: (v: string) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/users/${v}`)}>{v}</Button> },
    { title: '方式', dataIndex: 'authMethod', key: 'authMethod', width: 80 },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130, render: (v: string | null) => lookupLink(v) },
    { title: '区域', dataIndex: 'region', key: 'region', width: 120, render: (v: string | null) => v || '-' },
    { title: '设备ID', dataIndex: 'deviceId', key: 'deviceId', width: 150, ellipsis: true, render: (v: string | null) => lookupLink(v) },
    { title: '指纹', dataIndex: 'fpVisitor', key: 'fpVisitor', width: 150, ellipsis: true, render: (v: string | null) => lookupLink(v) },
    { title: 'User-Agent', dataIndex: 'userAgent', key: 'userAgent', ellipsis: true, render: (v: string | null) => v || '-' },
  ]

  const accountCount = result?.accounts.length ?? 0

  return (
    <div>
      <h2>指纹 / IP 查询</h2>
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        输入任意值（IP / 设备ID / 指纹 / 账号），一次全量反查所有关联账号与登录记录，用于识别多开小号 / 同人多账号。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          value={value}
          placeholder="输入 IP / 设备ID / 指纹 / 账号"
          style={{ width: 420 }}
          allowClear
          enterButton="查询"
          onChange={(e) => setValue(e.target.value)}
          onSearch={() => doSearch(value)}
        />
      </Space>

      {result && result.value && (
        <Alert
          type={accountCount > 1 ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              <b>{result.value}</b>：命中 <b>{accountCount}</b> 个账号、{result.logs.length} 条登录记录
              {accountCount > 1 && <Tag color="red" style={{ marginLeft: 8 }}>多账号共用，疑似多开</Tag>}
            </span>
          }
        />
      )}

      {result && result.value && (
        <>
          <Card title={`关联账号（${accountCount}）`} size="small" style={{ marginBottom: 16 }}>
            <Table columns={accountCols} dataSource={result.accounts} loading={loading} rowKey="userId" size="small" pagination={false} locale={{ emptyText: '无' }} />
          </Card>
          <Card title={`登录记录（${result.logs.length}，最多200条）`} size="small">
            <Table columns={logCols} dataSource={result.logs} loading={loading} rowKey="id" size="small" pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }} locale={{ emptyText: '无' }} />
          </Card>
        </>
      )}
    </div>
  )
}
