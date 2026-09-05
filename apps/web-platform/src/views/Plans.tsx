import { useEffect, useState } from 'react'
import { Alert, Button, Card, InputNumber, Space, Table, Tag, Typography, message } from 'antd'
import { getPlanOverrides, listPlatformPlans, setPlanOverride, type PlanOverrides, type PlatformPlan } from '../api'
import { useAuthStore } from '../stores/auth'

interface Draft { min: number | null; max: number | null }

/**
 * 套餐管理：套餐决定租户后台能把哪些商务参数改到什么范围（P1-14）。
 *
 * 放在租户详情里是错的 —— 这些区间是套餐级配置，改一次影响挂该套餐的所有租户，
 * 在某一家的详情页里改会让人以为只影响这一家。
 */
export default function Plans() {
  const role = useAuthStore((s) => s.role)
  const readonly = role !== 'platform_super'
  const [plans, setPlans] = useState<PlatformPlan[]>([])
  const [planId, setPlanId] = useState<number | null>(null)
  const [data, setData] = useState<PlanOverrides | null>(null)
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listPlatformPlans()
        setPlans(rows)
        setPlanId(rows[0]?.id ?? null)
      } catch (e) { message.error((e as Error).message) }
    })()
  }, [])

  async function load(id: number) {
    try {
      const res = await getPlanOverrides(id)
      setData(res)
      const d: Record<string, Draft> = {}
      for (const { key } of res.keys) d[key] = res.overrides[key] ?? { min: null, max: null }
      setDraft(d)
    } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { if (planId !== null) void load(planId) }, [planId])

  async function save(key: string) {
    if (planId === null) return
    const v = draft[key]
    if (v.min !== null && v.max !== null && v.min > v.max) { message.error('下限不能大于上限'); return }
    setSaving(key)
    try {
      await setPlanOverride(planId, key, v.min, v.max)
      await load(planId)
      message.success(v.min === null && v.max === null ? '已清除限制，该项回到平台不管' : '已保存，租户后台立即生效')
    } catch (e) { message.error((e as Error).message) }
    finally { setSaving(null) }
  }

  return (
    <Card title="套餐管理" loading={plans.length === 0}
      extra={<Space>
        {plans.map((p) => (
          <Button key={p.id} size="small" type={p.id === planId ? 'primary' : 'default'}
            onClick={() => setPlanId(p.id)}>{p.name}</Button>
        ))}
      </Space>}>
      {readonly && <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="只有平台超管能改套餐区间，这里只读" />}
      <Alert type="warning" showIcon style={{ marginBottom: 12 }}
        message="未登记的配置项一律放行 —— 平台没表态就是不管；登记后租户后台超出区间的取值会被直接拒绝" />

      {data && (
        <Table rowKey="key" size="small" pagination={false} dataSource={data.keys}
          columns={[
            { title: '配置项', dataIndex: 'label' },
            { title: '标识', dataIndex: 'key', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
            { title: '状态', width: 90, render: (_, r) => data.overrides[r.key]
              ? <Tag color="blue">已纳管</Tag> : <Tag>不限</Tag> },
            {
              title: '允许区间', render: (_, r) => (
                <Space>
                  <InputNumber size="small" style={{ width: 110 }} placeholder="下限（留空不限）"
                    disabled={readonly} value={draft[r.key]?.min ?? null}
                    onChange={(v) => setDraft((s) => ({ ...s, [r.key]: { ...s[r.key], min: v === null ? null : Number(v) } }))} />
                  <span>~</span>
                  <InputNumber size="small" style={{ width: 110 }} placeholder="上限（留空不限）"
                    disabled={readonly} value={draft[r.key]?.max ?? null}
                    onChange={(v) => setDraft((s) => ({ ...s, [r.key]: { ...s[r.key], max: v === null ? null : Number(v) } }))} />
                </Space>
              ),
            },
            {
              title: '操作', width: 80, render: (_, r) => {
                const cur = data.overrides[r.key] ?? { min: null, max: null }
                const d = draft[r.key] ?? cur
                const dirty = d.min !== cur.min || d.max !== cur.max
                return <Button size="small" type="primary" disabled={readonly || !dirty}
                  loading={saving === r.key} onClick={() => void save(r.key)}>保存</Button>
              },
            },
          ]} />
      )}
    </Card>
  )
}
