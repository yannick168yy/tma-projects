import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { getSystemParams, updateSystemParams, type SystemParams as SystemParamsDTO } from '../api'
import { useAuthStore } from '../stores/auth'

type ParamKey =
  | 'smsDailyLimitPerUser'
  | 'smsDailyLimitPerIp'
  | 'otpLockSeconds'
  | 'kycDocFailureLimit'
  | 'kycFaceFailureLimit'
  | 'loginPasswordFailureLimit'
  | 'loginPasswordLockSeconds'

type ParamType = '验证码' | '登录安全' | 'KYC'

interface ParamRow {
  key: ParamKey
  type: ParamType
  name: string
  description: string
  value: number
  max: number
}

export default function SystemParams() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [rows, setRows] = useState<ParamRow[]>([])
  const [feat, setFeat] = useState({ enabled: true, minAmount: 50, minMultiple: 20, wagerMult: 2 })
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ParamType | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const params = await getSystemParams()
      setRows([
        {
          key: 'smsDailyLimitPerUser',
          type: '验证码',
          name: '每人每日验证码上限',
          description: '适用于 KYC 手机验证、找回密码等所有短信验证码发送。默认 30 次/人/天。',
          value: params.smsDailyLimitPerUser,
          max: 1000,
        },
        {
          key: 'smsDailyLimitPerIp',
          type: '验证码',
          name: '每 IP 每日验证码上限',
          description: '限制同一 IP 每天可发送的验证码总数。默认 100 次/IP/天。',
          value: params.smsDailyLimitPerIp,
          max: 10000,
        },
        {
          key: 'otpLockSeconds',
          type: '验证码',
          name: '验证码错误锁定时长',
          description: '验证码连续输错 3 次后锁定验证方式的秒数。默认 60 秒。',
          value: params.otpLockSeconds,
          max: 3600,
        },
        {
          key: 'loginPasswordFailureLimit',
          type: '登录安全',
          name: '登录密码错误上限次数',
          description: '前台账号/手机号密码登录连续错误达到该次数后触发 Too many attempts。默认 5 次。',
          value: params.loginPasswordFailureLimit,
          max: 20,
        },
        {
          key: 'loginPasswordLockSeconds',
          type: '登录安全',
          name: '登录密码错误锁定时长',
          description: '前台账号/手机号密码登录达到错误上限后的锁定秒数。默认 600 秒。',
          value: params.loginPasswordLockSeconds,
          max: 86400,
        },
        {
          key: 'kycDocFailureLimit',
          type: 'KYC',
          name: 'KYC证件验证失败上限次数',
          description: '同一用户证件验证连续失败达到该次数后锁定 3 分钟。默认 3 次。',
          value: params.kycDocFailureLimit,
          max: 20,
        },
        {
          key: 'kycFaceFailureLimit',
          type: 'KYC',
          name: 'KYC人脸验证失败上限次数',
          description: '同一用户人脸验证连续失败达到该次数后锁定 3 分钟。默认 3 次。',
          value: params.kycFaceFailureLimit,
          max: 20,
        },
      ])
      setFeat({
        enabled: params.featureBonusLockEnabled,
        minAmount: params.featureBonusLockMinAmount,
        minMultiple: params.featureBonusLockMinMultiple,
        wagerMult: params.featureBonusLockWagerMult,
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function updateValue(key: ParamKey, value: number | null) {
    setRows((items) => items.map((item) => (item.key === key ? { ...item, value: Number(value ?? 0) } : item)))
  }

  const filteredRows = rows.filter((row) => {
    const q = search.trim().toLowerCase()
    const matchedType = typeFilter === 'all' || row.type === typeFilter
    const matchedSearch = !q || row.name.toLowerCase().includes(q) || row.description.toLowerCase().includes(q) || row.key.toLowerCase().includes(q)
    return matchedType && matchedSearch
  })

  async function save() {
    const rowVals = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<ParamKey, number>
    for (const row of rows) {
      if (!Number.isInteger(row.value) || row.value < 1 || row.value > row.max) {
        message.warning(`${row.name}必须是 1-${row.max} 的整数`); return
      }
    }
    if (!(feat.minAmount >= 0) || !(feat.minMultiple >= 1) || !(feat.wagerMult >= 0)) {
      message.warning('彩金流水闸：单笔最小额≥0、倍数阈值≥1、流水倍数≥0'); return
    }
    const next: SystemParamsDTO = {
      ...rowVals,
      featureBonusLockEnabled: feat.enabled,
      featureBonusLockMinAmount: feat.minAmount,
      featureBonusLockMinMultiple: feat.minMultiple,
      featureBonusLockWagerMult: feat.wagerMult,
    }
    setSaving(true)
    try {
      const saved = await updateSystemParams(next)
      setRows((items) => items.map((item) => ({ ...item, value: saved[item.key] })))
      setFeat({
        enabled: saved.featureBonusLockEnabled,
        minAmount: saved.featureBonusLockMinAmount,
        minMultiple: saved.featureBonusLockMinMultiple,
        wagerMult: saved.featureBonusLockWagerMult,
      })
      message.success('系统参数已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16 }}>
        <h2 style={{ margin: 0 }}>系统参数</h2>
      </div>
      <Card title="系统参数" bordered={false} loading={loading}>
        {!isSuperAdmin && (
          <Alert message="仅 super_admin 可修改系统参数" type="warning" showIcon style={{ marginBottom: 16 }} />
        )}
        <Space style={{ marginBottom: 16 }} wrap>
          <Input.Search
            allowClear
            placeholder="搜索参数名、说明或 key"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          <Select
            value={typeFilter}
            style={{ width: 160 }}
            options={[
              { label: '全部类型', value: 'all' },
              { label: '验证码', value: '验证码' },
              { label: '登录安全', value: '登录安全' },
              { label: 'KYC', value: 'KYC' },
            ]}
            onChange={(value) => setTypeFilter(value)}
          />
        </Space>
        <Table<ParamRow>
          rowKey="key"
          pagination={false}
          dataSource={filteredRows}
          columns={[
            {
              title: '类型',
              dataIndex: 'type',
              width: 120,
              render: (type: ParamType) => <Tag>{type}</Tag>,
            },
            { title: '参数', dataIndex: 'name', width: 240 },
            { title: '说明', dataIndex: 'description' },
            {
              title: '值',
              dataIndex: 'value',
              width: 220,
              render: (value: number, row) => (
                <InputNumber
                  min={1}
                  max={row.max}
                  precision={0}
                  value={value}
                  disabled={!isSuperAdmin}
                  style={{ width: 160 }}
                  onChange={(next) => updateValue(row.key, next)}
                />
              ),
            },
          ]}
        />
        {isSuperAdmin && <Button type="primary" loading={saving} onClick={save} style={{ marginTop: 16 }}>保存</Button>}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          验证码发送计数按菲律宾时间自然日重置；KYC 达到失败上限后锁定 3 分钟，验证成功后清零。
        </Typography.Paragraph>
      </Card>

      <Card title="老虎机彩金流水闸" bordered={false} style={{ marginTop: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="怎么生效：两个条件同时满足，才给这笔派彩加流水锁"
          description={(
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              老虎机 feature/免费旋转派彩中，当【单笔派彩 ≥ 最小额】<b>且</b>【派彩 ÷ 触发注 ≥ 倍数阈值】<b>同时</b>满足时，
              自动给这笔派彩补「派彩额 × 流水倍数」的流水要求，用户打满该流水后才可提现（用于拦「小额存款靠老虎机 bonus 通道爆量套现」）。<br />
              · <b>派彩倍数阈值</b>（主判据）：抓「小注博大彩」的薅羊毛形状 —— 如下注 5 中 1725 = 345 倍会锁；巨鲸大注低倍（如 500 中 5000 = 10 倍）不锁。<b>调低更严、调高更松。</b><br />
              · <b>单笔派彩最小额</b>（噪音地板）：过滤「倍数高但金额很小」的碎钱，如 0.1 中 20（200 倍但只 20 元）不锁。<br />
              · <b>流水倍数</b>：命中后要打几倍流水才解锁，2 = 派彩额打 2 遍。<br />
              · 仅对游戏内 feature 派彩（IsGameProviderPromotion=false）生效，平台活动彩金、普通中奖不受影响。改动约 30 秒生效，无需重新部署。
            </div>
          )}
        />
        {!isSuperAdmin && (
          <Alert message="仅 super_admin 可修改系统参数" type="warning" showIcon style={{ marginBottom: 16 }} />
        )}
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <span style={{ display: 'inline-block', width: 200 }}>启用</span>
            <Switch checked={feat.enabled} disabled={!isSuperAdmin} onChange={(v) => setFeat((f) => ({ ...f, enabled: v }))} />
            <Tag color={feat.enabled ? 'green' : 'default'}>{feat.enabled ? '开' : '关'}</Tag>
          </Space>
          <Space>
            <span style={{ display: 'inline-block', width: 200 }}>单笔派彩最小额(PHP)</span>
            <InputNumber min={0} max={1000000} precision={2} value={feat.minAmount} disabled={!isSuperAdmin} style={{ width: 160 }} onChange={(v) => setFeat((f) => ({ ...f, minAmount: Number(v ?? 0) }))} />
            <Typography.Text type="secondary">低于此额不锁，过滤正常小奖</Typography.Text>
          </Space>
          <Space>
            <span style={{ display: 'inline-block', width: 200 }}>派彩倍数阈值(派彩÷触发注)</span>
            <InputNumber min={1} max={100000} precision={1} value={feat.minMultiple} disabled={!isSuperAdmin} style={{ width: 160 }} onChange={(v) => setFeat((f) => ({ ...f, minMultiple: Number(v ?? 1) }))} />
            <Typography.Text type="secondary">达到才锁；小注爆高倍=farming 签名（值越低越严）</Typography.Text>
          </Space>
          <Space>
            <span style={{ display: 'inline-block', width: 200 }}>流水倍数</span>
            <InputNumber min={0} max={100} precision={1} value={feat.wagerMult} disabled={!isSuperAdmin} style={{ width: 160 }} onChange={(v) => setFeat((f) => ({ ...f, wagerMult: Number(v ?? 0) }))} />
            <Typography.Text type="secondary">锁定流水 = 派彩额 × 此倍数</Typography.Text>
          </Space>
        </Space>
        {isSuperAdmin && <Button type="primary" loading={saving} onClick={save} style={{ marginTop: 16 }}>保存</Button>}
      </Card>
    </div>
  )
}
