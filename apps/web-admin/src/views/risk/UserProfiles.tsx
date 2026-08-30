import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Checkbox, Drawer, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'
import {
  addRiskTag, getRiskUser, getRiskUsers, removeRiskTag,
  getBlacklist, addBlacklist, removeBlacklist,
  type RiskUserDetail, type RiskUserItem,
} from '../../api'
import { actionTag, scoreTag, sourceTag, tagLabel } from './shared'
import { PAGE_SIZE_OPTIONS } from '../../pagination'

const TAG_OPTIONS = [
  { value: 'risk.bonus_abuse', label: '薅优惠党' },
  { value: 'risk.multi_account', label: '多账户农场' },
  { value: 'risk.arbitrage', label: '套利/对冲' },
]

export default function RiskUserProfiles() {
  const [items, setItems] = useState<RiskUserItem[]>([])
  const [loading, setLoading] = useState(false)
  const [tag, setTag] = useState<string | undefined>()
  const [minScore, setMinScore] = useState(0)
  const [minDeviceShared, setMinDeviceShared] = useState(0)
  const [minBonusRatio, setMinBonusRatio] = useState(0)
  const [userIdInput, setUserIdInput] = useState('')
  const [userIdQuery, setUserIdQuery] = useState('')
  const [onlyBlacklisted, setOnlyBlacklisted] = useState(false)
  // userId -> 名单记录 id，用于展示状态与移出名单
  const [blacklistMap, setBlacklistMap] = useState<Map<string, number>>(new Map())
  const [detail, setDetail] = useState<RiskUserDetail | null>(null)
  const [detailUser, setDetailUser] = useState<string | null>(null)
  const [tagModal, setTagModal] = useState(false)
  const [form] = Form.useForm()
  // 加入名单弹窗
  const [blockModal, setBlockModal] = useState<{ open: boolean; userId: string; reason: string }>({ open: false, userId: '', reason: '' })
  const [blocking, setBlocking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, bl] = await Promise.all([
        getRiskUsers({ tag, minScore, minDeviceShared, minBonusRatio, userId: userIdQuery || undefined, limit: 100 }),
        getBlacklist('user'),
      ])
      setItems(res.items)
      setBlacklistMap(new Map(bl.items.map((b) => [b.value, b.id])))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [tag, minScore, minDeviceShared, minBonusRatio, userIdQuery])
  useEffect(() => { void load() }, [load])

  async function confirmBlock() {
    setBlocking(true)
    try {
      await addBlacklist({ type: 'user', value: blockModal.userId, reason: blockModal.reason || undefined })
      message.success('已加入风控名单')
      setBlockModal({ open: false, userId: '', reason: '' })
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加入失败（需权限）')
    } finally {
      setBlocking(false)
    }
  }

  async function unblock(id: number) {
    try {
      await removeBlacklist(id)
      message.success('已移出风控名单')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '移出失败')
    }
  }

  const shown = onlyBlacklisted ? items.filter((r) => blacklistMap.has(r.userId)) : items

  const openDetail = useCallback(async (userId: string) => {
    setDetailUser(userId)
    setDetail(null)
    try { setDetail(await getRiskUser(userId)) } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
  }, [])

  async function submitTag() {
    const values = await form.validateFields()
    try {
      await addRiskTag(detailUser!, values)
      message.success('已打标（人工标不会被跑批覆盖）')
      setTagModal(false); form.resetFields()
      await openDetail(detailUser!); await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '打标失败')
    }
  }

  async function dropTag(tagCode: string) {
    try {
      await removeRiskTag(detailUser!, tagCode)
      message.success('已移除')
      await openDetail(detailUser!); await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '移除失败')
    }
  }

  return (
    <Card title="用户风险画像">
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear placeholder="用户ID" style={{ width: 180 }}
          value={userIdInput}
          onChange={(e) => setUserIdInput(e.target.value)}
          onSearch={(v) => setUserIdQuery(v.trim())}
        />
        <Select allowClear placeholder="按标签筛选" style={{ width: 160 }} value={tag} onChange={setTag} options={TAG_OPTIONS} />
        <InputNumber min={0} max={100} value={minScore} onChange={(v) => setMinScore(v ?? 0)} addonBefore="风险分 ≥" style={{ width: 150 }} />
        <InputNumber min={0} value={minDeviceShared} onChange={(v) => setMinDeviceShared(v ?? 0)} addonBefore="同设备账号 ≥" style={{ width: 180 }} />
        <InputNumber min={0} step={0.5} value={minBonusRatio} onChange={(v) => setMinBonusRatio(v ?? 0)} addonBefore="彩金/充值 ≥" style={{ width: 190 }} />
        <Checkbox checked={onlyBlacklisted} onChange={(e) => setOnlyBlacklisted(e.target.checked)}>仅名单用户</Checkbox>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey="userId"
        size="small"
        loading={loading}
        dataSource={shown}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 20, pageSizeOptions: PAGE_SIZE_OPTIONS }}
        columns={[
          { title: '用户', dataIndex: 'userId', render: (id: string) => <a onClick={() => void openDetail(id)}>{id}</a> },
          { title: '风险分', dataIndex: 'riskScore', render: scoreTag, sorter: (a, b) => a.riskScore - b.riskScore, defaultSortOrder: 'descend' },
          { title: '标签', dataIndex: 'tags', render: (tags: RiskUserItem['tags']) => tags.length ? tags.map((t) => <span key={t.tagCode}>{tagLabel(t.tagCode)}{sourceTag(t.source)}</span>) : <Tag>无</Tag> },
          { title: '彩金（USDT等值）', dataIndex: 'bonusTotal', render: (v: number) => `USDT ${v.toFixed(2)}` },
          { title: '净充值（USDT等值）', dataIndex: 'netDeposit', render: (v: number) => `USDT ${v.toFixed(2)}` },
          { title: '彩金/充值', dataIndex: 'bonusRatio', render: (v: number) => v >= 9999 ? <Tag color="red">∞（零充值）</Tag> : v.toFixed(2) },
          { title: '提现次数', dataIndex: 'withdrawCount' },
          { title: '同设备账号', dataIndex: 'deviceSharedUsers', render: (v: number) => v >= 3 ? <Tag color="red">{v}</Tag> : v },
          { title: '同IP账号', dataIndex: 'ipSharedUsers' },
          {
            title: '名单', key: 'blacklist', fixed: 'right', width: 120,
            render: (_: unknown, r: RiskUserItem) => {
              const blId = blacklistMap.get(r.userId)
              return blId
                ? (
                  <Popconfirm title="将该用户移出风控名单？" onConfirm={() => void unblock(blId)}>
                    <Space size={4}><Tag color="red">已在名单</Tag><a style={{ color: '#1677ff' }}>移出</a></Space>
                  </Popconfirm>
                )
                : <a onClick={() => setBlockModal({ open: true, userId: r.userId, reason: '' })}>加入名单</a>
            },
          },
        ]}
      />

      <Drawer
        open={!!detailUser}
        onClose={() => { setDetailUser(null); setDetail(null) }}
        width={720}
        title={`风险画像 · ${detailUser ?? ''}`}
        extra={<Button type="primary" onClick={() => setTagModal(true)}>人工打标</Button>}
      >
        {detail?.signal && (
          <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="风险分">{scoreTag(detail.signal.riskScore)}</Descriptions.Item>
            <Descriptions.Item label="彩金/充值">{detail.signal.bonusRatio >= 9999 ? '∞（零充值）' : detail.signal.bonusRatio.toFixed(4)}</Descriptions.Item>
            <Descriptions.Item label="累计彩金（USDT等值）">USDT {detail.signal.bonusTotal.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="累计充值（USDT等值）">USDT {detail.signal.netDeposit.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="成功提现次数">{detail.signal.withdrawCount}</Descriptions.Item>
            <Descriptions.Item label="同设备账号数">{detail.signal.deviceSharedUsers}</Descriptions.Item>
            <Descriptions.Item label="同 IP 账号数">{detail.signal.ipSharedUsers}</Descriptions.Item>
            <Descriptions.Item label="快照时间">{String(detail.signal.computedAt ?? '-')}</Descriptions.Item>
          </Descriptions>
        )}

        <Card size="small" title="标签与证据" style={{ marginBottom: 16 }}>
          <Table
            rowKey="tagCode"
            size="small"
            pagination={false}
            dataSource={detail?.tags ?? []}
            locale={{ emptyText: '无标签' }}
            columns={[
              { title: '标签', dataIndex: 'tagCode', render: (c: string) => tagLabel(c, detail?.tagMeta) },
              { title: '来源', dataIndex: 'source', render: sourceTag },
              { title: '置信度', dataIndex: 'confidence' },
              { title: '操作人', dataIndex: 'assignedBy', render: (v: string | null) => v ?? '-' },
              { title: '证据', dataIndex: 'evidence', render: (e: unknown) => <code style={{ fontSize: 11 }}>{e ? JSON.stringify(e) : '-'}</code> },
              {
                title: '', render: (_, r) => (
                  <Popconfirm title="移除该标签？" description={r.source === 'auto' ? '这是自动标，下次跑批若仍命中会重新生成' : undefined} onConfirm={() => void dropTag(r.tagCode)}>
                    <a style={{ color: '#cf1322' }}>移除</a>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </Card>

        <Card size="small" title="最近风控命中">
          <Table
            rowKey={(r) => `${r.createdAt}:${r.ruleCode}`}
            size="small"
            pagination={false}
            dataSource={detail?.hits ?? []}
            locale={{ emptyText: '无命中记录' }}
            columns={[
              { title: '时间', dataIndex: 'createdAt', render: (v: string) => String(v).slice(0, 19) },
              { title: '管控点', dataIndex: 'checkpoint' },
              { title: '规则', dataIndex: 'ruleCode' },
              { title: '动作', dataIndex: 'action', render: actionTag },
              { title: '命中值', dataIndex: 'matchedValue', render: (v: string | null) => v ?? '-' },
            ]}
          />
        </Card>
      </Drawer>

      <Modal open={tagModal} title="人工打标" onCancel={() => setTagModal(false)} onOk={() => void submitTag()} okText="确认">
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="tagCode" label="标签" rules={[{ required: true, message: '请选择标签' }]}>
            <Select options={TAG_OPTIONS} placeholder="选择标签" />
          </Form.Item>
          <Form.Item name="reason" label="判定依据" rules={[{ required: true, message: '请填写依据，供日后复核与用户申诉' }]}>
            <Input.TextArea rows={3} placeholder="例：核对注单后确认为对冲套利" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={blockModal.open}
        title={`加入风控名单 · ${blockModal.userId}`}
        confirmLoading={blocking}
        okText="确认加入"
        okButtonProps={{ danger: true }}
        onCancel={() => setBlockModal({ open: false, userId: '', reason: '' })}
        onOk={() => void confirmBlock()}
      >
        <p style={{ color: '#cf1322', marginBottom: 12 }}>名单立即生效：登录/注册、优惠领取将被拒绝，提现将转人工审核。</p>
        <Input.TextArea
          rows={3}
          placeholder="原因（选填，供日后复核与用户申诉）"
          value={blockModal.reason}
          onChange={(e) => setBlockModal((m) => ({ ...m, reason: e.target.value }))}
        />
      </Modal>
    </Card>
  )
}
