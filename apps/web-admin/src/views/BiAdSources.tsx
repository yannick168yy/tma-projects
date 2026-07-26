import { useCallback, useEffect, useState } from 'react'
import { Button, Card, DatePicker, Input, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getAdSources, getAdSourceTrend, getCapiTokens, upsertCapiToken, deleteCapiToken, revealCapiToken,
  type AdSourceRow, type AdSourceReport, type CapiPixelToken,
} from '../api'
import { LineChart } from '../components/BiCharts'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()
const ARPU_TARGET = 1200 // 条款客均门槛 ₱1200

// 马尼拉今天（展示层用本地 dayjs 即可，服务端按 UTC+8 切日）
const manilaToday = () => dayjs()

// CAPI 像素 token 配置：投流方各 BM 出像素，token 按像素一一配置。
// token 默认只显尾号；super_admin 可点「显示」拉完整明文（走独立接口+审计）。支持编辑既有像素。
function CapiTokenPanel() {
  const isSuper = localStorage.getItem('admin_role') === 'super_admin'
  const [rows, setRows] = useState<CapiPixelToken[]>([])
  const [loading, setLoading] = useState(false)
  const emptyForm = { platform: 'facebook', pixelId: '', accessToken: '', testEventCode: '', promoDomain: '', remark: '' }
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Record<number, string>>({})

  const load = useCallback(() => {
    setLoading(true)
    getCapiTokens().then(setRows).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const resetForm = () => { setForm(emptyForm); setEditingId(null) }

  const startEdit = (r: CapiPixelToken) => {
    setEditingId(r.id)
    setForm({
      platform: r.platform, pixelId: r.pixelId, accessToken: '',
      testEventCode: r.testEventCode ?? '', promoDomain: r.promoDomain ?? '', remark: r.remark ?? '',
    })
  }

  const reveal = async (id: number) => {
    try {
      const { token } = await revealCapiToken(id)
      setRevealed((m) => ({ ...m, [id]: token }))
    } catch (e) { message.error((e as Error).message) }
  }
  const hide = (id: number) => setRevealed((m) => { const n = { ...m }; delete n[id]; return n })

  const submit = async () => {
    const token = form.accessToken.trim()
    if (!/^[\w-]{5,64}$/.test(form.pixelId.trim())) { message.warning('像素 ID 格式不对'); return }
    if (editingId === null && token.length < 10) { message.warning('新增像素必须填 access token'); return }
    if (token && token.length < 10) { message.warning('access token 太短'); return }
    try {
      await upsertCapiToken({
        platform: form.platform,
        pixelId: form.pixelId.trim(),
        accessToken: token || undefined, // 编辑时留空=保持原 token
        testEventCode: form.testEventCode.trim() || undefined,
        promoDomain: form.promoDomain.trim() || undefined,
        remark: form.remark.trim() || undefined,
      })
      message.success('已保存')
      if (editingId !== null) hide(editingId) // token 可能已变，清掉旧的明文缓存
      resetForm()
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns = [
    { title: '平台', dataIndex: 'platform', render: (v: string) => <Tag color={v === 'facebook' ? 'blue' : 'default'}>{v}</Tag> },
    { title: '像素 ID', dataIndex: 'pixelId' },
    {
      title: 'Token', dataIndex: 'tokenTail',
      render: (v: string, r: CapiPixelToken) => (revealed[r.id]
        ? (
          <Space size={4}>
            <Typography.Text copyable={{ text: revealed[r.id] }} style={{ fontSize: 11, wordBreak: 'break-all', maxWidth: 260, display: 'inline-block' }} code>{revealed[r.id]}</Typography.Text>
            <a onClick={() => hide(r.id)}>隐藏</a>
          </Space>
        )
        : (
          <Space size={6}>
            <code>••••{v}</code>
            {isSuper && <a onClick={() => reveal(r.id)}>显示</a>}
          </Space>
        )),
    },
    {
      title: <Tooltip title="非空时事件带 test_event_code 上报，FB「测试事件」页实时可见；验证完应清空(编辑留空即清)">测试码</Tooltip>,
      dataIndex: 'testEventCode',
      render: (v: string | null) => (v ? <Tag color="orange">{v}</Tag> : '—'),
    },
    {
      title: <Tooltip title="该线投放使用的推广域名，投放链接应带此域名">推广域名</Tooltip>,
      dataIndex: 'promoDomain',
      render: (v: string | null) => (v ? <a href={`https://${v}`} target="_blank" rel="noreferrer">{v}</a> : '—'),
    },
    { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? '—' },
    { title: '更新时间', dataIndex: 'updatedAt', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
    ...(isSuper ? [{
      title: '操作', key: 'op',
      render: (_: unknown, r: CapiPixelToken) => (
        <Space size={8}>
          <a onClick={() => startEdit(r)}>编辑</a>
          <Popconfirm title="删除后该像素的服务端回传将回退全局 token（未配则停发）" onConfirm={async () => { await deleteCapiToken(r.id); load() }}>
            <a style={{ color: '#cf1322' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ]

  return (
    <Card
      bordered={false} size="small" style={{ marginTop: 16 }}
      title="CAPI 像素 Token（服务端回传凭证）"
    >
      <div style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
        投流方每条线提供 FB / TikTok 像素 ID + 对应 BM 的 CAPI access token，在此登记后服务端才会给该像素回传
        CompleteRegistration / Purchase。super_admin 可点「显示」查看完整 token；编辑既有像素时 token 留空即保持不变。
      </div>
      {isSuper && (
        <Space style={{ marginBottom: 12 }} wrap>
          <Select
            value={form.platform} style={{ width: 110 }} disabled={editingId !== null}
            options={[{ value: 'facebook', label: 'Facebook' }, { value: 'tiktok', label: 'TikTok' }]}
            onChange={(v) => setForm((f) => ({ ...f, platform: v }))}
          />
          <Input
            placeholder="像素 ID" value={form.pixelId} style={{ width: 180 }} disabled={editingId !== null}
            onChange={(e) => setForm((f) => ({ ...f, pixelId: e.target.value }))}
          />
          <Input.Password
            placeholder={editingId !== null ? '留空=不修改 token' : 'access token'} value={form.accessToken} style={{ width: 260 }}
            onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
          />
          <Input
            placeholder="测试码 TESTxxx（可空）" value={form.testEventCode} style={{ width: 150 }}
            onChange={(e) => setForm((f) => ({ ...f, testEventCode: e.target.value }))}
          />
          <Input
            placeholder="推广域名 betogo666.com（可空）" value={form.promoDomain} style={{ width: 190 }}
            onChange={(e) => setForm((f) => ({ ...f, promoDomain: e.target.value }))}
          />
          <Input
            placeholder="备注（线路/投手，可空）" value={form.remark} style={{ width: 180 }}
            onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
          />
          <Button type="primary" onClick={submit}>{editingId !== null ? '保存修改' : '新增'}</Button>
          {editingId !== null && <Button onClick={resetForm}>取消编辑</Button>}
        </Space>
      )}
      <Table size="small" rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={false} />
    </Card>
  )
}

export default function BiAdSources() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([manilaToday().subtract(6, 'day'), manilaToday()])
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AdSourceReport | null>(null)
  const [trendChannel, setTrendChannel] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ dates: string[]; reg: number[]; fd: number[]; arpu: (number | null)[] } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getAdSources({
      from: range[0].format('YYYY-MM-DD'),
      to: range[1].format('YYYY-MM-DD'),
      currency: 'PHP',
      channel: channel.trim() || undefined,
    }).then(setData).finally(() => setLoading(false))
  }, [range, channel])

  useEffect(() => { load() }, [load])

  const openTrend = (code: string) => {
    setTrendChannel(code)
    setTrend(null)
    getAdSourceTrend({
      channel: code,
      from: range[0].format('YYYY-MM-DD'),
      to: range[1].format('YYYY-MM-DD'),
      currency: 'PHP',
    }).then((r) => {
      setTrend({
        dates: r.points.map((p) => p.date.slice(5)),
        reg: r.points.map((p) => p.regUsers),
        fd: r.points.map((p) => p.firstDepUsers),
        arpu: r.points.map((p) => (p.arpu == null ? null : Math.round(p.arpu))),
      })
    })
  }

  const arpuCell = (v: number | null) => {
    if (v == null) return <span style={{ color: '#bbb' }}>—</span>
    const ok = v >= ARPU_TARGET
    return <span style={{ color: ok ? '#3f8600' : '#cf1322', fontWeight: 500 }}>{fmtMoney(v)}</span>
  }

  const columns = [
    {
      title: '渠道标识', dataIndex: 'channelCode', fixed: 'left' as const,
      render: (v: string) => <a onClick={() => openTrend(v)}>{v}</a>,
    },
    {
      title: <Tooltip title="download 页点 APK 下载的次数（仅 Android 站外包）">下载数</Tooltip>,
      dataIndex: 'downloads',
      sorter: (a: AdSourceRow, b: AdSourceRow) => a.downloads - b.downloads,
    },
    {
      title: <Tooltip title="下载后实际安装并首次打开 App 的数量（按 IP+机型 24h 窗配对成功）">安装数</Tooltip>,
      dataIndex: 'installs',
      sorter: (a: AdSourceRow, b: AdSourceRow) => a.installs - b.installs,
    },
    { title: '注册数', dataIndex: 'regUsers', sorter: (a: AdSourceRow, b: AdSourceRow) => a.regUsers - b.regUsers },
    {
      title: <Tooltip title="平台历史首笔成功充值发生在所选区间内的人数">首存人数</Tooltip>,
      dataIndex: 'firstDepUsers',
      sorter: (a: AdSourceRow, b: AdSourceRow) => a.firstDepUsers - b.firstDepUsers,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: <Tooltip title="首存转化率 = 首存人数 ÷ 注册数">首存转化</Tooltip>, key: 'cvr',
      render: (_: unknown, r: AdSourceRow) => (r.regUsers > 0 ? `${((r.firstDepUsers / r.regUsers) * 100).toFixed(1)}%` : '—'),
    },
    { title: '首存金额(₱)', dataIndex: 'firstDepAmount', render: fmtMoney },
    { title: <Tooltip title="区间内该渠道用户的充值总额(含复充)">总充值(₱)</Tooltip>, dataIndex: 'depositAmount', render: fmtMoney },
    {
      title: <Tooltip title="客均 = 总充值 ÷ 首存人数；条款要求 ≥ ₱1200，达标绿色">客均(₱)</Tooltip>,
      dataIndex: 'arpu', render: arpuCell,
      sorter: (a: AdSourceRow, b: AdSourceRow) => (a.arpu ?? -1) - (b.arpu ?? -1),
    },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>投放渠道（买量）</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        渠道标识 = 投放链接里的 <code>?c=</code>（缺省时退回 utm_source）。数据实时查询，按马尼拉日（UTC+8）切日，
        币种口径 PHP。首存成本由投手用「广告花费 ÷ 首存人数」自算——我方只提供首存数。点渠道名看逐日趋势。
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <DatePicker.RangePicker
          value={range} format="YYYY-MM-DD" allowClear={false} style={{ width: 240 }}
          onChange={(v) => { if (v && v[0] && v[1]) setRange([v[0], v[1]]) }}
        />
        <Input
          placeholder="按渠道标识筛选（可空）" allowClear value={channel} style={{ width: 200 }}
          onChange={(e) => setChannel(e.target.value)} onPressEnter={load}
        />
        <Button type="primary" onClick={load}>查询</Button>
      </Space>

      <Spin spinning={loading}>
        {data && (
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag>下载 {data.totals.downloads} / 安装 {data.totals.installs}</Tag>
            <Tag color="blue">注册 {data.totals.regUsers}</Tag>
            <Tag color="geekblue">首存 {data.totals.firstDepUsers}</Tag>
            <Tag color="green">总充值 ₱{fmtMoney(data.totals.depositAmount)}</Tag>
            <Tag color={data.totals.arpu != null && data.totals.arpu >= ARPU_TARGET ? 'success' : 'error'}>
              整体客均 {data.totals.arpu == null ? '—' : `₱${fmtMoney(data.totals.arpu)}`}
            </Tag>
          </Space>
        )}

        <Card bordered={false} size="small">
          <Table
            size="small" rowKey="channelCode" columns={columns}
            dataSource={data?.rows ?? []} pagination={false} scroll={{ x: 900 }}
          />
        </Card>

        {trendChannel && (
          <Card
            bordered={false} size="small" style={{ marginTop: 16 }}
            title={`渠道趋势：${trendChannel}`}
            extra={<a onClick={() => { setTrendChannel(null); setTrend(null) }}>收起</a>}
          >
            {trend
              ? <LineChart
                  dates={trend.dates}
                  series={[
                    { name: '注册', data: trend.reg },
                    { name: '首存人数', data: trend.fd },
                    { name: '客均(₱)', data: trend.arpu, dashed: true },
                  ]}
                  height={300}
                />
              : <Spin />}
          </Card>
        )}
      </Spin>

      <CapiTokenPanel />
    </div>
  )
}
