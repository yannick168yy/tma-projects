import { useEffect, useState } from 'react'
import { Alert, Button, Card, InputNumber, Space, Table, Tag, Typography, message } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { getTenants, updateTenantPool, type TenantRow } from '../api'
import { useAuthStore } from '../stores/auth'

type Row = TenantRow & { key: number }

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  trial: { text: '试用', color: 'blue' },
  active: { text: '正常', color: 'green' },
  withdraw_suspended: { text: '停提现', color: 'orange' },
  deposit_suspended: { text: '停充值', color: 'orange' },
  suspended: { text: '停站', color: 'red' },
  closed: { text: '关站', color: 'default' },
}

export default function Tenants() {
  const { role } = useAuthStore()
  const editable = role === 'super_admin'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      setRows((await getTenants()).map((t) => ({ ...t, key: t.id })))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function patch(id: number, field: 'poolMin' | 'poolMax' | 'queueLimit', value: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  async function save(row: Row) {
    if (row.poolMin > row.poolMax) { message.error('初始连接数不能大于最大连接数'); return }
    setSavingId(row.id)
    try {
      const res = await updateTenantPool(row.id, row.poolMin, row.poolMax, row.queueLimit)
      message.success(res.poolRecreated ? '已保存，连接池已按新配置重建' : '已保存，下次建池时生效')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally { setSavingId(null) }
  }

  const totalMax = rows.reduce((sum, r) => sum + r.poolMax, 0)

  return (
    <Card
      title="租户与连接池"
      extra={<Button onClick={() => void load()} loading={loading}>刷新</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="连接池按租户配置"
        description={
          <div>
            <div>初始连接数 = 池创建后预热并常驻的连接（对应 mysql2 的 maxIdle），最大连接数 = 硬上限。</div>
            <div>排队上限 0 表示不限；设成有限值可以让过载快速失败，而不是在内存里无声堆积拖垮进程。</div>
            <div style={{ marginTop: 6 }}>
              当前所有租户最大连接数合计 <b>{totalMax}</b>，需小于 MySQL 的 max_connections（另需为 core-node 与运维预留）。
            </div>
          </div>
        }
      />
      {!editable && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="仅 super_admin 可修改" />}
      <Table<Row>
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="small"
        columns={[
          { title: '代号', dataIndex: 'code', width: 120,
            render: (code: string, row) => (
              <Space>
                <span>{code}</span>
                {row.selfOperated && <Tag color="gold">自营</Tag>}
              </Space>
            ) },
          { title: '名称', dataIndex: 'name', width: 160 },
          { title: '库', dataIndex: 'database', width: 150 },
          { title: '状态', dataIndex: 'status', width: 90,
            render: (s: string) => {
              const meta = STATUS_LABEL[s] ?? { text: s, color: 'default' }
              return <Tag color={meta.color}>{meta.text}</Tag>
            } },
          { title: '域名数', dataIndex: 'domainCount', width: 80 },
          { title: '初始连接', width: 110,
            render: (_, row) => (
              <InputNumber min={0} max={row.poolMax} value={row.poolMin} disabled={!editable}
                onChange={(v) => patch(row.id, 'poolMin', Number(v ?? 0))} style={{ width: 90 }} />
            ) },
          { title: '最大连接', width: 110,
            render: (_, row) => (
              <InputNumber min={1} max={100} value={row.poolMax} disabled={!editable}
                onChange={(v) => patch(row.id, 'poolMax', Number(v ?? 1))} style={{ width: 90 }} />
            ) },
          { title: '排队上限', width: 110,
            render: (_, row) => (
              <InputNumber min={0} max={10000} value={row.queueLimit} disabled={!editable}
                onChange={(v) => patch(row.id, 'queueLimit', Number(v ?? 0))} style={{ width: 90 }} />
            ) },
          { title: '操作', width: 100,
            render: (_, row) => (
              <Button type="primary" size="small" icon={<SaveOutlined />} disabled={!editable}
                loading={savingId === row.id} onClick={() => void save(row)}>保存</Button>
            ) },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        修改后会立即丢弃该租户的旧连接池，下一个请求按新配置重建（连接数上限在建池时固定，不重建不生效）。
      </Typography.Paragraph>
    </Card>
  )
}
