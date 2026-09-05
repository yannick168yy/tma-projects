import { useEffect, useState } from 'react'
import { Alert, Card, Select, Space, Table, Tag, Typography, message } from 'antd'
import { Link } from 'react-router-dom'
import { getTenantFeatures, setTenantFeature, type TenantFeatures } from '../../api'
import { useTenant } from './context'

const FEATURE_LABEL: Record<string, string> = {
  slots: '电子', live: '真人', sports: '体育', lottery: '彩票', fishing: '捕鱼',
  task: '任务', checkin: '签到', spin: '转盘', vip: 'VIP',
  rebate: '洗码返水', loss_rebate: '负盈利返水',
  team_commission: '团队佣金', agent_center: '代理中心',
  community: '社区营销', tg_broadcast: 'TG 群发', cs_ai: '客服 AI',
  kyc: 'KYC', login_telegram: 'TG 登录', login_google: 'Google 登录',
  app_download: 'APP 下载页',
}

/**
 * 功能开关矩阵。三态：跟随套餐 / 单独开 / 单独关。
 *
 * 必须能看出「这个关是套餐带的还是这家单独关的」—— 只显示生效值的话，
 * 没法判断清掉覆盖会回到什么，换套餐后更是一笔糊涂账。
 */
export default function Plan() {
  const { d } = useTenant()
  const [data, setData] = useState<TenantFeatures | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    try { setData(await getTenantFeatures(d.id)) } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [d.id])

  async function change(key: string, value: 'inherit' | 'on' | 'off') {
    setSaving(key)
    try {
      await setTenantFeature(d.id, key, value === 'inherit' ? null : value === 'on')
      await load()
      message.success('已保存，前台缓存已刷新')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const overridden = data ? Object.keys(data.overrides).length : 0

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Alert
        type="info"
        showIcon
        message={<Space>
          <span>当前套餐</span>
          <Tag color="blue">{d.planName ?? '未分配'}</Tag>
          <Typography.Text type="secondary">
            套餐默认值与可覆盖范围在 <Link to="/plans">套餐管理</Link> 里改，改动影响挂该套餐的所有租户
          </Typography.Text>
        </Space>}
      />

      <Card title="功能开关" size="small" loading={!data}
        extra={<Typography.Text type="secondary">
          本租户单独设了 {overridden} 项，覆盖优先于套餐默认值
        </Typography.Text>}>
        {data && (
          <Table rowKey="key" size="small" pagination={false}
            dataSource={data.keys.map((key) => ({ key }))}
            columns={[
              { title: '功能', dataIndex: 'key', render: (k: string) => FEATURE_LABEL[k] ?? k },
              { title: '标识', dataIndex: 'key', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
              {
                title: '套餐默认',
                dataIndex: 'key',
                render: (k: string) => data.planDefaults[k] === false ? <Tag>关</Tag> : <Tag color="green">开</Tag>,
              },
              {
                title: '本租户',
                dataIndex: 'key',
                render: (k: string) => (
                  <Select<'inherit' | 'on' | 'off'> size="small" style={{ width: 120 }}
                    loading={saving === k} disabled={saving !== null}
                    value={data.overrides[k] === undefined ? 'inherit' : data.overrides[k] ? 'on' : 'off'}
                    onChange={(v) => void change(k, v)}
                    options={[
                      { value: 'inherit', label: '跟随套餐' },
                      { value: 'on', label: '单独开' },
                      { value: 'off', label: '单独关' },
                    ]} />
                ),
              },
              {
                title: '生效',
                dataIndex: 'key',
                render: (k: string) => data.effective[k] === false
                  ? <Tag color="red">关</Tag>
                  : <Tag color="green">开</Tag>,
              },
            ]} />
        )}
      </Card>
    </Space>
  )
}
