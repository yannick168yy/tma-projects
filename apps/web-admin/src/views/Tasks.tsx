import { useEffect, useState } from 'react'
import { Alert, Card, Table, Switch, InputNumber, Input, Select, Button, message, Spin, Tabs, Typography, Tag, Space, Popconfirm, Segmented } from 'antd'
import {
  getTaskConfig, saveTaskConfig, type TaskConfig, type TaskRewardCfg, type TaskRewardType,
  getTaskSocial, saveTaskSocial, type TaskSocialConfig,
  getTaskReviews, reviewTaskManual, type TaskManualReview,
  CONFIG_CCY_OPTIONS,
} from '../api'

const { Title, Text } = Typography

const NATIVE_LABELS: Record<string, string> = {
  daily_deposit_t1: '今日存款阶梯 · 第1档',
  daily_deposit_t2: '今日存款阶梯 · 第2档',
  daily_deposit_t3: '今日存款阶梯 · 第3档',
  daily_bets: '每日投注挑战（阈值=笔数）',
  daily_play: '今日试玩运营位（阈值=局数）',
  profile_complete: '绑定社交账号（Google+TG）',
  first_game: '首次游戏下注',
  invite_milestone: '邀请好友',
}

const PLAY_CATEGORY_OPTS = ['slot', 'live', 'fishing', 'poker', 'perya', 'sports', 'lottery', 'other']
  .map((v) => ({ value: v, label: v }))

const REWARD_TYPE_OPTS: { value: TaskRewardType; label: string }[] = [
  { value: 'cash', label: '现金' },
  { value: 'spin', label: '抽奖次数' },
  { value: 'growth', label: '成长值' },
]

/** 按前台分区展示原生任务配置；保存时提交全量配置（其余分区字段原样带回）
 *  currencyScoped=true（每日留存任务）时按币种独立配置；否则（新手拉新任务）固定 PHP */
function NativeConfig({ ids, title, currencyScoped = false }: { ids: string[]; title: string; currencyScoped?: boolean }) {
  const [cfg, setCfg] = useState<TaskConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [currency, setCurrency] = useState<string>('PHP')
  const effCur = currencyScoped ? currency : 'PHP'

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [effCur])
  async function load() {
    setLoading(true)
    try { setCfg((await getTaskConfig(effCur)).config) } catch { message.error('加载失败') } finally { setLoading(false) }
  }
  function patch(key: string, p: Partial<TaskRewardCfg>) {
    setCfg((c) => (c ? { ...c, [key]: { ...c[key], ...p } } : c))
  }
  async function save() {
    if (!cfg) return
    setSaving(true)
    try { await saveTaskConfig(cfg, effCur); message.success(`已保存（${effCur}）`); setCfg((await getTaskConfig(effCur)).config) }
    catch { message.error('保存失败') } finally { setSaving(false) }
  }

  if (loading || !cfg) return <Spin style={{ margin: 40 }} />
  const rows = ids.filter((k) => cfg[k]).map((k) => ({ key: k, ...cfg[k] }))

  return (
    <Card title={title} extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}>
      {currencyScoped && (
        <Space style={{ marginBottom: 12 }} align="center">
          <Text strong>币种：</Text>
          <Segmented value={currency} onChange={(v) => setCurrency(String(v))}
            options={CONFIG_CCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          <Text type="secondary" style={{ fontSize: 12 }}>留存类每日任务按币种独立(金额/门槛为该币种口径);切换即加载该币种,未配则从PHP÷58派生</Text>
        </Space>
      )}
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
          { title: '单笔有效额', dataIndex: 'minStake', render: (v: number, r) => r.key === 'daily_bets' ? <InputNumber min={0} value={v} onChange={(x) => patch(r.key, { minStake: Number(x) })} /> : <Text type="secondary">-</Text> },
          { title: '指定分类', dataIndex: 'category', render: (v: string, r) => r.key === 'daily_play' ? <Select style={{ width: 100 }} value={v || 'slot'} options={PLAY_CATEGORY_OPTS} onChange={(x) => patch(r.key, { category: x })} /> : <Text type="secondary">-</Text> },
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
        tg_member=Bot 须设为频道管理员，channel_ref 填频道 @username 或 chat_id；code_redeem=码放"加入才可见"处并定期轮换、奖励压小。
      </Text>
      <Table
        style={{ marginTop: 12 }} pagination={false} dataSource={rows} rowKey="task_key" scroll={{ x: 1300 }}
        columns={[
          { title: '标识', dataIndex: 'task_key', fixed: 'left', width: 130 },
          { title: '平台', dataIndex: 'platform', width: 90 },
          { title: '验证策略', dataIndex: 'verify_strategy', width: 130, render: (v: TaskSocialConfig['verify_strategy'], r) => (
            <Select style={{ width: 120 }} value={v} onChange={(x) => patch(r.task_key, { verify_strategy: x })}
              options={[{ value: 'tg_member', label: 'TG成员' }, { value: 'code_redeem', label: '回填码' }, { value: 'manual_review', label: '截图审核' }]} /> ) },
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

// 与前台任务中心的三个 tab（New Player / Daily / Social）一一对应
const NEWBIE_IDS = ['profile_complete', 'first_game', 'invite_milestone']
const DAILY_IDS = ['daily_deposit_t1', 'daily_deposit_t2', 'daily_deposit_t3', 'daily_bets', 'daily_play']

function NewbieTab() {
  return (
    <>
      <Alert
        style={{ marginBottom: 12 }} type="info" showIcon
        message="前台新手区其余卡片的配置位置"
        description="领取新手体验金 / 下载 App 礼金 / 首充彩金 → 营销运营 · 活动配置；解锁生日礼金 → KYC 通过后自动同步证件生日，无需配置。"
      />
      <NativeConfig ids={NEWBIE_IDS} title="新手任务" />
    </>
  )
}

function DailyTab() {
  return (
    <>
      <Alert
        style={{ marginBottom: 12 }} type="info" showIcon
        message="前台每日区其余卡片的配置位置"
        description="每日签到与签到里程碑（7/15/30 天）→ 任务体系 · 每日签到 页配置。"
      />
      <NativeConfig ids={DAILY_IDS} title="每日任务" currencyScoped />
    </>
  )
}

function SocialTab() {
  return (
    <>
      <SocialConfig />
      <div style={{ marginTop: 16 }}><Reviews /></div>
    </>
  )
}

export default function Tasks() {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>任务中心</Title>
      <Tabs
        defaultActiveKey="newbie"
        items={[
          { key: 'newbie', label: '新手任务', children: <NewbieTab /> },
          { key: 'daily', label: '每日任务', children: <DailyTab /> },
          { key: 'social', label: '社群任务', children: <SocialTab /> },
        ]}
      />
    </div>
  )
}
