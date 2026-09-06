import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch,
  Table, Tag, Typography, message,
} from 'antd'
import {
  applyPromoTemplate, deletePromoTemplate, exportPromoTemplate, listPlatformTenants,
  listPromoTemplates, previewPromoTemplate, setPromoTemplateEnabled,
  type PlatformTenant, type PromoDiffRow, type PromoTemplate, type PromoTemplateApply,
} from '../api'
import { useAuthStore } from '../stores/auth'

/**
 * 活动模板市场（P3-3）。
 *
 * 模板 = 一套验证过的活动参数（可只含几个区块），不是活动 DSL。
 * 现有 8 类活动的领取条件、流水锁、结算时机各不相同，硬塞进一套通用模型
 * 要么表达不了、要么算出来的钱与现有实现有细微差别 —— 活动算错钱是直接资损。
 * 真实痛点是「照 X 站那套来」，所以做法是：调好一家 → 导出成模板 → 套给后面的。
 */
export default function PromoTemplates() {
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_ops'
  const [sections, setSections] = useState<Array<{ key: string; label: string }>>([])
  const [items, setItems] = useState<PromoTemplate[]>([])
  const [history, setHistory] = useState<PromoTemplateApply[]>([])
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [form] = Form.useForm<{ tenantId: number; code: string; name: string; description?: string; market?: string; sections: string[] }>()
  const [applyTarget, setApplyTarget] = useState<{ tpl: PromoTemplate; tenantId?: number } | null>(null)
  const [diff, setDiff] = useState<{ templateName: string; diff: PromoDiffRow[]; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [res, ts] = await Promise.all([listPromoTemplates(), listPlatformTenants()])
      setSections(res.sections)
      setItems(res.items)
      setHistory(res.history)
      setTenants(ts)
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function submitExport() {
    const v = await form.validateFields()
    try {
      const res = await exportPromoTemplate(v.tenantId, {
        code: v.code, name: v.name, description: v.description,
        market: v.market || null, sections: v.sections,
      })
      setItems(res.items)
      setExportOpen(false)
      form.resetFields()
      message.success('已导出为模板')
    } catch (e) { message.error((e as Error).message) }
  }

  async function loadDiff(tpl: PromoTemplate, tenantId: number) {
    setDiff(null)
    try { setDiff(await previewPromoTemplate(tpl.id, tenantId)) }
    catch (e) { message.error((e as Error).message) }
  }

  async function doApply() {
    if (!applyTarget?.tenantId) return
    setBusy(true)
    try {
      const res = await applyPromoTemplate(applyTarget.tpl.id, applyTarget.tenantId)
      setHistory(res.history)
      setApplyTarget(null)
      setDiff(null)
      message.success(`已套用：${res.applied.join('、')}`)
      await load()
    } catch (e) { message.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const sectionLabel = (k: string) => sections.find((s) => s.key === k)?.label ?? k

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="活动模板" loading={loading}
        extra={canWrite && <Button size="small" type="primary" onClick={() => setExportOpen(true)}>
          从租户导出模板
        </Button>}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="模板存的是「一套活动参数」，套用走后台改配置的同一条校验路径 —— 后台改不进去的值，套模板也进不去"
          description="模板只覆盖它包含的区块，其余保持租户原样，所以「只调首充档位」的模板不会顺手冲掉人家的弹窗配置。套用前可以先看逐区块差异。" />
        <Table<PromoTemplate> rowKey="id" size="small" pagination={false} dataSource={items}
          locale={{ emptyText: '还没有模板 —— 先把一家调好，再导出成模板' }}
          columns={[
            { title: '模板', dataIndex: 'name',
              render: (v: string, r) => <Space direction="vertical" size={0}>
                <span style={{ fontWeight: 600 }}>{v}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.code}</Typography.Text>
              </Space> },
            { title: '覆盖区块', dataIndex: 'sections',
              render: (v: string[]) => <Space size={4} wrap>{v.map((k) => <Tag key={k}>{sectionLabel(k)}</Tag>)}</Space> },
            { title: '适用市场', dataIndex: 'market', width: 100,
              render: (v: string | null) => v ?? <Tag>通用</Tag> },
            { title: '来源', dataIndex: 'sourceTenantCode', width: 110,
              render: (v: string | null) => v ?? <Typography.Text type="secondary">手工</Typography.Text> },
            { title: '被套用', dataIndex: 'applyCount', width: 90, align: 'right',
              render: (v: number) => v > 0 ? <Tag color="blue">{v} 次</Tag> : <Typography.Text type="secondary">0</Typography.Text> },
            { title: '说明', dataIndex: 'description', ellipsis: true },
            ...(canWrite ? [{
              title: '操作', width: 170,
              render: (_: unknown, r: PromoTemplate) => (
                <Space size={4}>
                  <Button size="small" type="link" disabled={!r.enabled}
                    onClick={() => { setApplyTarget({ tpl: r }); setDiff(null) }}>套用</Button>
                  <Switch size="small" checked={r.enabled}
                    onChange={(v) => void setPromoTemplateEnabled(r.id, v).then((res) => setItems(res.items))} />
                  <Popconfirm title="删除该模板？" description="已套用的租户配置不受影响"
                    onConfirm={() => void deletePromoTemplate(r.id).then((res) => setItems(res.items))}>
                    <Button size="small" type="link" danger>删</Button>
                  </Popconfirm>
                </Space>
              ),
            }] : []),
          ]} />
      </Card>

      <Card title="套用记录" size="small" loading={loading}>
        <Table<PromoTemplateApply> rowKey="id" size="small" pagination={{ pageSize: 8, size: 'small' }}
          dataSource={history}
          locale={{ emptyText: '暂无套用记录' }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 170,
              render: (v: string) => v.slice(0, 19).replace('T', ' ') },
            { title: '租户', dataIndex: 'tenantCode', width: 120 },
            { title: '模板', dataIndex: 'templateName' },
            { title: '操作人', dataIndex: 'appliedBy', width: 140,
              render: (v: string | null, r) => <Space size={4}>
                <span>{v ?? '—'}</span>
                <Tag color={r.bySide === 'tenant' ? 'blue' : 'gold'}>{r.bySide === 'tenant' ? '客户自助' : '平台'}</Tag>
              </Space> },
          ]} />
      </Card>

      <Modal title="从租户当前配置导出模板" open={exportOpen} onCancel={() => setExportOpen(false)}
        onOk={submitExport} destroyOnClose width={560}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="导出的是该租户此刻的活动参数。之后这家再改，模板不会跟着变" />
        <Form form={form} layout="vertical" size="small">
          <Form.Item name="tenantId" label="来源租户" rules={[{ required: true }]}>
            <Select options={tenants.map((t) => ({ value: t.id, label: `${t.code}（${t.name}）` }))} />
          </Form.Item>
          <Form.Item name="sections" label="导出哪些区块" rules={[{ required: true, message: '至少选一个' }]}>
            <Select mode="multiple" options={sections.map((s) => ({ value: s.key, label: s.label }))} />
          </Form.Item>
          <Form.Item name="code" label="模板代号"
            rules={[{ required: true, pattern: /^[a-z0-9_]{2,32}$/, message: '小写字母、数字、下划线' }]}>
            <Input placeholder="ph_aggressive" />
          </Form.Item>
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
            <Input placeholder="菲律宾 · 激进拉新型" />
          </Form.Item>
          <Form.Item name="market" label="适用市场" help="留空=通用">
            <Select allowClear options={[{ value: 'PH', label: 'PH' }, { value: 'ID', label: 'ID' }]} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={200} placeholder="首充低档高送 + 复充每日 3 次，适合拉新期" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`套用模板 · ${applyTarget?.tpl.name ?? ''}`} open={applyTarget !== null} width={760}
        onCancel={() => { setApplyTarget(null); setDiff(null) }}
        onOk={doApply} confirmLoading={busy}
        okButtonProps={{ disabled: !applyTarget?.tenantId || Boolean(diff?.error) }}
        okText="确认套用">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select style={{ width: 280 }} placeholder="套用到哪个租户"
            value={applyTarget?.tenantId}
            onChange={(v) => {
              if (!applyTarget) return
              setApplyTarget({ ...applyTarget, tenantId: v })
              void loadDiff(applyTarget.tpl, v)
            }}
            options={tenants.map((t) => ({ value: t.id, label: `${t.code}（${t.name}）` }))} />
          {diff?.error && <Alert type="error" showIcon message={`套用后参数非法：${diff.error}`} />}
          {diff && (
            <Table<PromoDiffRow> rowKey="section" size="small" pagination={false} dataSource={diff.diff}
              columns={[
                { title: '区块', dataIndex: 'label', width: 130 },
                { title: '当前', dataIndex: 'before',
                  render: (v: unknown) => <Typography.Text code style={{ fontSize: 11 }}>
                    {JSON.stringify(v).slice(0, 160)}</Typography.Text> },
                { title: '套用后', dataIndex: 'after',
                  render: (v: unknown) => <Typography.Text code style={{ fontSize: 11 }}>
                    {JSON.stringify(v).slice(0, 160)}</Typography.Text> },
              ]} />
          )}
        </Space>
      </Modal>
    </Space>
  )
}
