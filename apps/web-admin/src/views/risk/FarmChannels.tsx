import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Drawer, Space, Table, Tag, Tooltip, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getFarmChannels, getFarmChannelDetail,
  type FarmChannelRow, type FarmChannelDetailRow,
} from '../../api'

const FMT = 'YYYY-MM-DD'

function statusTag(s: string) {
  if (s === 'banned') return <Tag color="red">已封禁</Tag>
  if (s === 'frozen') return <Tag color="orange">冻结</Tag>
  return <Tag color="green">正常</Tag>
}

function pctTag(pct: number) {
  const color = pct >= 60 ? 'red' : pct >= 30 ? 'orange' : pct > 0 ? 'gold' : 'default'
  return <Tag color={color}>{pct}%</Tag>
}

export default function RiskFarmChannels() {
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [rows, setRows] = useState<FarmChannelRow[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<{ channel: string; items: FarmChannelDetailRow[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getFarmChannels(date.format(FMT))
      setRows(res.items)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [date])
  useEffect(() => { void load() }, [load])

  const openDetail = useCallback(async (channel: string) => {
    setDetail({ channel, items: [] })
    setDetailLoading(true)
    try {
      const res = await getFarmChannelDetail(date.format(FMT), channel)
      setDetail({ channel, items: res.items })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载明细失败')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [date])

  const isToday = date.isSame(dayjs(), 'day')

  return (
    <Card
      title="投放渠道套利客"
      extra={(
        <Space>
          <DatePicker
            value={date}
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            onChange={(d) => d && setDate(d)}
          />
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新{isToday ? '当天' : ''}
          </Button>
        </Space>
      )}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="口径说明"
        description={
          <span>
            套利客 = 设备指纹(device_id 或硬件指纹)被 <b>≥3 个账号</b>共用；疑似 = 同 IP <b>≥5 个账号</b>且无设备信号（IP 噪声大，单列不计入套利）。
            关联范围为全站全时段（抓团伙老主号），人群为当天带投放归因的注册，已剔除风控白名单测试机。
            {isToday && ' 当天数据实时计算，点「刷新当天」取最新。'}
          </span>
        }
      />
      <Table
        rowKey="channel"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        rowClassName={(r) => (r.isTotal ? 'farm-total-row' : '')}
        columns={[
          {
            title: '渠道', dataIndex: 'channel',
            render: (c: string, r: FarmChannelRow) => r.isTotal ? <b>合计</b> : c,
          },
          { title: '进入人数', dataIndex: 'entrants', align: 'right', sorter: (a, b) => a.entrants - b.entrants },
          {
            title: <Tooltip title="设备/硬件指纹共用≥3号">套利客</Tooltip>, dataIndex: 'farmDevice', align: 'right',
            render: (v: number) => v > 0 ? <b style={{ color: '#cf1322' }}>{v}</b> : v,
            sorter: (a, b) => a.farmDevice - b.farmDevice,
          },
          {
            title: <Tooltip title="同IP≥5号且无设备信号">疑似(仅IP)</Tooltip>, dataIndex: 'suspectIp', align: 'right',
            render: (v: number) => v || '-',
          },
          {
            title: '套利占比', dataIndex: 'farmPct', align: 'right',
            render: pctTag, sorter: (a, b) => a.farmPct - b.farmPct, defaultSortOrder: 'descend',
          },
          {
            title: <Tooltip title="该渠道最大团伙的关联账号数(全站)">最大团伙</Tooltip>, dataIndex: 'maxRing', align: 'right',
            render: (v: number) => v >= 3 ? <Tag color="volcano">{v}</Tag> : v,
          },
          {
            title: '操作', key: 'op', align: 'center', width: 100,
            render: (_: unknown, r: FarmChannelRow) =>
              r.isTotal || r.farmDevice === 0 ? null : <a onClick={() => void openDetail(r.channel)}>查看明细</a>,
          },
        ]}
      />

      <Drawer
        open={!!detail}
        width={900}
        title={`套利客明细 · ${detail?.channel ?? ''} · ${date.format(FMT)}`}
        onClose={() => setDetail(null)}
      >
        <Table
          rowKey="userId"
          size="small"
          loading={detailLoading}
          dataSource={detail?.items ?? []}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          columns={[
            { title: '用户', dataIndex: 'userId' },
            {
              title: '关联账号数', dataIndex: 'ring', align: 'right',
              render: (v: number) => <Tag color="volcano">{v}</Tag>,
              sorter: (a, b) => a.ring - b.ring, defaultSortOrder: 'descend',
            },
            { title: '设备指纹', dataIndex: 'deviceFp', render: (v: string | null) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '-' },
            { title: '账号状态', dataIndex: 'status', render: statusTag },
            { title: '累计彩金（PHP等值）', dataIndex: 'bonusTotal', align: 'right', render: (v: number | null) => v == null ? '-' : `PHP ${v.toFixed(2)}` },
            { title: '净充值（PHP等值）', dataIndex: 'netDeposit', align: 'right', render: (v: number | null) => v == null ? '-' : `PHP ${v.toFixed(2)}` },
            { title: '提现次数', dataIndex: 'withdrawCount', align: 'right', render: (v: number | null) => v ?? '-' },
            { title: '注册时间', dataIndex: 'createdAt', render: (v: string) => String(v).slice(0, 19) },
          ]}
        />
      </Drawer>
    </Card>
  )
}
