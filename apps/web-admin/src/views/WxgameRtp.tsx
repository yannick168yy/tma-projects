import { useEffect, useState } from 'react'
import { Table, Space, Input, Button, Tag, message, Modal, Select, Alert, Tooltip } from 'antd'
import {
  getWxgameRtpTiers, getWxgameRtpList, setWxgameRtp, unsetWxgameRtp, verifyWxgameRtp,
  type WxgameRtpRecord,
} from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

function fmtTime(t: string | null) {
  if (!t) return <span style={{ color: '#bbb' }}>—</span>
  return <span style={{ fontSize: 12, color: '#888' }}>{new Date(t).toLocaleString('zh-CN', { hour12: false })}</span>
}

export default function WxgameRtp() {
  const [rows, setRows] = useState<WxgameRtpRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [tiers, setTiers] = useState<string[]>([])
  const [merchantType, setMerchantType] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ userIds: '', rtp: '', reason: '', opPassword: '' })
  const [upstream, setUpstream] = useState<Record<string, string | null>>({})

  const load = async () => {
    setLoading(true)
    try {
      const r = await getWxgameRtpList({ userId: userId.trim() || undefined, page, pageSize })
      setRows(r.items); setTotal(r.total)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [page, pageSize])
  useEffect(() => {
    void getWxgameRtpTiers().then((r) => { setTiers(r.tiers); setMerchantType(r.merchantType) }).catch(() => {})
  }, [])

  const submit = async (mode: 'set' | 'unset') => {
    const userIds = form.userIds.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean)
    if (userIds.length === 0) { message.warning('请填写用户 ID'); return }
    if (!form.opPassword) { message.warning('请输入操作密码'); return }
    if (mode === 'set' && !form.rtp) { message.warning('请选择档位'); return }
    try {
      const r = mode === 'set'
        ? await setWxgameRtp({ userIds, rtp: form.rtp, reason: form.reason || undefined, opPassword: form.opPassword })
        : await unsetWxgameRtp({ userIds, opPassword: form.opPassword })
      // 上游只返回成功的，失败的必须显式提示 —— 否则运营会以为全设上了
      if (r.failed.length > 0) {
        message.warning(`成功 ${r.applied.length} 个，失败 ${r.failed.length} 个：${r.failed.join(', ')}`)
      } else {
        message.success(`已${mode === 'set' ? '设置' : '清除'} ${r.applied.length} 个玩家`)
      }
      setEditOpen(false); setForm({ userIds: '', rtp: '', reason: '', opPassword: '' })
      void load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const checkUpstream = async () => {
    if (rows.length === 0) return
    try {
      const r = await verifyWxgameRtp(rows.map((x) => x.userId))
      setUpstream(Object.fromEntries(r.items.map((i) => [i.userId, i.upstreamRtp])))
      message.success('已拉取上游实际值')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '核对失败')
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert
        type="warning" showIcon
        message={`当前为「${merchantType === 'regular' ? '常规' : merchantType}」商户，可用档位 ${tiers.join(' / ')}`}
        description="常规户不支持 100 / 150 / 500 放水档，需要的话要向 WXGame 申请转高爆户。调整档位直接影响玩家赢面，需要超管权限和操作密码，每次操作都会记入审计日志。"
      />
      <Space wrap>
        <Input placeholder="按用户 ID 筛选" value={userId} onChange={(e) => setUserId(e.target.value)}
          onPressEnter={() => { setPage(1); void load() }} style={{ width: 200 }} allowClear />
        <Button onClick={() => { setPage(1); void load() }}>查询</Button>
        <Button type="primary" onClick={() => setEditOpen(true)}>设置 / 清除点控</Button>
        <Tooltip title="拉取 WXGame 上游的实际生效值，与本地记录比对">
          <Button onClick={checkUpstream} disabled={rows.length === 0}>与上游核对</Button>
        </Tooltip>
      </Space>

      <Table<WxgameRtpRecord>
        rowKey="userId" dataSource={rows} loading={loading} size="small"
        pagination={{
          current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          onChange: (p, ps) => { setPage(p); setPageSize(ps) },
        }}
        columns={[
          { title: '用户 ID', dataIndex: 'userId' },
          { title: 'WXGame 账号', dataIndex: 'playerId', render: (v: string | null) => v ?? <span style={{ color: '#bbb' }}>未开号</span> },
          { title: '档位', dataIndex: 'rtp', render: (v: string) => <Tag color={Number(v) < 90 ? 'red' : 'blue'}>{v}</Tag> },
          {
            title: '同步状态', dataIndex: 'synced',
            render: (v: boolean) => v
              ? <Tag color="green">已生效</Tag>
              : <Tooltip title="上游未确认成功。常见原因：该玩家还没在 WXGame 开过号，会在首次进游戏时自动生效">
                  <Tag color="orange">未同步</Tag>
                </Tooltip>,
          },
          {
            title: '上游实际值', key: 'upstream',
            render: (_, r) => {
              const v = upstream[r.userId]
              if (v === undefined) return <span style={{ color: '#bbb' }}>点「与上游核对」</span>
              if (v === null) return <Tag color="default">上游无记录</Tag>
              return v === r.rtp ? <Tag color="green">{v}</Tag> : <Tag color="red">{v}（与本地不一致）</Tag>
            },
          },
          { title: '操作人', dataIndex: 'operatorId', render: (v: string | null) => v ?? '—' },
          { title: '原因', dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
          { title: '更新时间', dataIndex: 'updatedAt', render: fmtTime },
        ]}
      />

      <Modal
        title="设置 / 清除点控 RTP" open={editOpen} onCancel={() => setEditOpen(false)}
        footer={[
          <Button key="unset" danger onClick={() => submit('unset')}>清除点控（恢复默认 95）</Button>,
          <Button key="set" type="primary" onClick={() => submit('set')}>设置档位</Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea rows={3} placeholder="用户 ID，多个用逗号或换行分隔（上游单次最多 1000 个）"
            value={form.userIds} onChange={(e) => setForm({ ...form, userIds: e.target.value })} />
          <Select style={{ width: '100%' }} placeholder="RTP 档位" value={form.rtp || undefined}
            onChange={(v) => setForm({ ...form, rtp: v })}
            options={tiers.map((t) => ({ value: t, label: `${t}${t === '95' ? '（开户默认）' : ''}` }))} />
          <Input placeholder="调整原因（会记入审计日志）" value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Input.Password placeholder="操作密码" value={form.opPassword}
            onChange={(e) => setForm({ ...form, opPassword: e.target.value })} />
        </Space>
      </Modal>
    </Space>
  )
}
