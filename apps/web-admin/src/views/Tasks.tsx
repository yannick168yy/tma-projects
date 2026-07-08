import { useEffect, useState } from 'react'
import { Card, Table, Switch, InputNumber, Input, Select, Button, message, Spin, Typography, Tag, Space, Popconfirm } from 'antd'
import {
  getTaskConfig, saveTaskConfig, type TaskConfig, type TaskRewardCfg, type TaskRewardType,
  getTaskSocial, saveTaskSocial, type TaskSocialConfig,
  getTaskReviews, reviewTaskManual, type TaskManualReview,
} from '../api'

const { Title, Text } = Typography

const NATIVE_LABELS: Record<string, string> = {
  daily_login: '每日登录',
  daily_deposit: '今日完成一笔存款',
  profile_complete: '完善资料 / 绑定邮箱',
  first_withdraw: '首次提现',
  first_game: '首次游戏下注',
}

const REWARD_TYPE_OPTS: { value: TaskRewardType; label: string }[] = [
  { value: 'cash', label: '现金' },
  { value: 'spin', label: '抽奖次数' },
  { value: 'growth', label: '成长值' },
]

function NativeConfig() {
  const [cfg, setCfg] = useState<TaskConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { void load() }, [])
  async function load() {
    setLoading(true)
    try { setCfg(await getTaskConfig()) } catch { message.error('加载失败') } finally { setLoading(false) }
  }
  function patch(key: string, p: Partial<TaskRewardCfg>) {
    setCfg((c) => (c ? { ...c, [key]: { ...c[key], ...p } } : c))
  }
  async function save() {
    if (!cfg) return
    setSaving(true)
    try { await saveTaskConfig(cfg); message.success('已保存'); setCfg(await getTaskConfig()) }
    catch { message.error('保存失败') } finally { setSaving(false) }
  }

  if (loading || !cfg) return <Spin style={{ margin: 40 }} />
  const rows = Object.keys(cfg).map((k) => ({ key: k, ...cfg[k] }))

  return (
    <Card title="原生任务配置" extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}>
      <Text type="secondary">任务只奖成长体系不碰的行为（首次/回访/完善）。现金奖励带打码倍数防薅。</Text>
      <Table
        style={{ marginTop: 12 }} pagination={false} dataSource={rows} rowKey="key"
        columns={[
          { title: '任务', dataIndex: 'key', render: (k: string) => NATIVE_LABELS[k] ?? k },
          { title: '开关', dataIndex: 'enabled', render: (v: boolean, r) => <Switch checked={v} onChange={(x) => patch(r.key, { enabled: x })} /> },
          { title: '奖励类型', dataIndex: 'rewardType', render: (v: TaskRewardType, r) => <Select style={{ width: 110 }} value={v} options={REWARD_TYPE_OPTS} onChange={(x) => patch(r.key, { rewardType: x })} /> },
          { title: '现金/成长值', dataIndex: 'amount', render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.key, { amount: Number(x) })} /> },
          { title: '抽奖次数', dataIndex: 'spin', render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.key, { spin: Number(x) })} /> },
          { title: '打码倍数', dataIndex: 'turnoverX', render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.key, { turnoverX: Number(x) })} /> },
          { title: '达标阈值', dataIndex: 'threshold', render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.key, { threshold: Number(x) })} /> },
        ]}
      />
    </Card>
  )
}

function SocialConfig() {
  const [rows, setRows] = useState<TaskSocialConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => { void load() }, [])
  async function load() {
    setLoading(true)
    try { setRows(await getTaskSocial()) } catch { message.error('加载失败') } finally { setLoading(false) }
  }
  function patch(key: string, p: Partial<TaskSocialConfig>) {
    setRows((rs) => rs.map((r) => (r.task_key === key ? { ...r, ...p } : r)))
  }
  async function saveRow(row: TaskSocialConfig) {
    setSavingKey(row.task_key)
    try { await saveTaskSocial(row.task_key, row); message.success('已保存') }
    catch { message.error('保存失败') } finally { setSavingKey(null) }
  }

  if (loading) return <Spin style={{ margin: 40 }} />

  return (
    <Card title="社群关注任务">
      <Text type="secondary">
        tg_member=Bot 须设为频道管理员，channel_ref 填频道 @username 或 chat_id；code_redeem=码放"加入才可见"处并定期轮换、奖励压小；bind_only=仅需绑定 Telegram。
      </Text>
      <Table
        style={{ marginTop: 12 }} pagination={false} dataSource={rows} rowKey="task_key" scroll={{ x: 1300 }}
        columns={[
          { title: '标识', dataIndex: 'task_key', fixed: 'left', width: 130 },
          { title: '平台', dataIndex: 'platform', width: 90 },
          { title: '验证策略', dataIndex: 'verify_strategy', width: 130, render: (v: TaskSocialConfig['verify_strategy'], r) => (
            <Select style={{ width: 120 }} value={v} onChange={(x) => patch(r.task_key, { verify_strategy: x })}
              options={[{ value: 'tg_member', label: 'TG成员' }, { value: 'code_redeem', label: '回填码' }, { value: 'manual_review', label: '截图审核' }, { value: 'bind_only', label: '仅绑定' }]} /> ) },
          { title: '标题', dataIndex: 'title', width: 160, render: (v: string, r) => <Input value={v} onChange={(e) => patch(r.task_key, { title: e.target.value })} /> },
          { title: '副标题', dataIndex: 'subtitle', width: 180, render: (v: string, r) => <Input value={v} onChange={(e) => patch(r.task_key, { subtitle: e.target.value })} /> },
          { title: '跳转链接', dataIndex: 'action_url', width: 180, render: (v: string, r) => <Input value={v} onChange={(e) => patch(r.task_key, { action_url: e.target.value })} /> },
          { title: '频道标识', dataIndex: 'channel_ref', width: 150, render: (v: string, r) => <Input placeholder="@channel / chat_id" value={v} onChange={(e) => patch(r.task_key, { channel_ref: e.target.value })} /> },
          { title: '当前暗号', dataIndex: 'redeem_code', width: 120, render: (v: string, r) => <Input value={v} onChange={(e) => patch(r.task_key, { redeem_code: e.target.value })} /> },
          { title: '奖励类型', dataIndex: 'reward_type', width: 110, render: (v: TaskRewardType, r) => <Select style={{ width: 100 }} value={v} options={REWARD_TYPE_OPTS} onChange={(x) => patch(r.task_key, { reward_type: x })} /> },
          { title: '现金', dataIndex: 'reward_amount', width: 90, render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.task_key, { reward_amount: Number(x) })} /> },
          { title: '次数', dataIndex: 'reward_spin', width: 80, render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.task_key, { reward_spin: Number(x) })} /> },
          { title: '打码', dataIndex: 'turnover_x', width: 80, render: (v: number, r) => <InputNumber min={0} value={v} onChange={(x) => patch(r.task_key, { turnover_x: Number(x) })} /> },
          { title: '开关', dataIndex: 'enabled', width: 70, render: (v: number, r) => <Switch checked={!!v} onChange={(x) => patch(r.task_key, { enabled: x ? 1 : 0 })} /> },
          { title: '操作', key: 'op', fixed: 'right', width: 90, render: (_: unknown, r) => <Button size="small" type="primary" loading={savingKey === r.task_key} onClick={() => saveRow(r)}>保存</Button> },
        ]}
      />
    </Card>
  )
}

function Reviews() {
  const [rows, setRows] = useState<TaskManualReview[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => { void load() }, [])
  async function load() {
    setLoading(true)
    try { setRows(await getTaskReviews('pending')) } catch { message.error('加载失败') } finally { setLoading(false) }
  }
  async function act(id: number, approve: boolean) {
    setBusy(id)
    try { await reviewTaskManual(id, approve); message.success(approve ? '已通过' : '已驳回'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') } finally { setBusy(null) }
  }

  if (loading) return <Spin style={{ margin: 40 }} />

  return (
    <Card title="截图人工审核（待审）">
      <Table
        pagination={false} dataSource={rows} rowKey="id"
        columns={[
          { title: '用户', dataIndex: 'user_id' },
          { title: '任务', dataIndex: 'task_key' },
          { title: '截图', dataIndex: 'screenshot_url', render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">查看</a> : <Tag>无</Tag> },
          { title: '提交时间', dataIndex: 'created_at' },
          { title: '操作', key: 'op', render: (_: unknown, r) => (
            <Space>
              <Popconfirm title="确认通过并发奖？" onConfirm={() => act(r.id, true)}><Button size="small" type="primary" loading={busy === r.id}>通过</Button></Popconfirm>
              <Button size="small" danger loading={busy === r.id} onClick={() => act(r.id, false)}>驳回</Button>
            </Space>
          ) },
        ]}
      />
    </Card>
  )
}

export default function Tasks({ section }: { section: 'config' | 'social' | 'reviews' }) {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>任务体系</Title>
      {section === 'config' && <NativeConfig />}
      {section === 'social' && <SocialConfig />}
      {section === 'reviews' && <Reviews />}
    </div>
  )
}
