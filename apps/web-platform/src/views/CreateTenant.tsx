import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Button, Card, Checkbox, Form, Input, InputNumber, Result,
  Select, Space, Table, Tag, Typography, message,
} from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import {
  listPlatformPlans, provisionTenant,
  type PlatformPlan, type ProvisionResult,
} from '../api'

// 与平台库 001_init.sql 的种子数据、site-domain.service.ts 的市场判定保持一致。
// 目前只开放这两个市场；新市场上线时这里和后端 provision 逻辑要一起扩。
const MARKET_PRESET: Record<string, { label: string; currency: string; timezone: string }> = {
  PH: { label: '菲律宾 PH', currency: 'PHP', timezone: 'Asia/Manila' },
  ID: { label: '印尼 ID', currency: 'IDR', timezone: 'Asia/Jakarta' },
}

const CODE_RULE = { pattern: /^[a-z][a-z0-9]{2,15}$/, message: '3-16 位小写字母数字，且以字母开头' }

interface FormValues {
  code: string
  name: string
  planCode: string
  markets: string[]
  domains: Array<{ domain: string; market: string }>
  adminUsername: string
  adminPassword: string
  poolMin: number
  poolMax: number
}

export default function CreateTenant() {
  const nav = useNavigate()
  const [form] = Form.useForm<FormValues>()
  const [plans, setPlans] = useState<PlatformPlan[]>([])
  const [markets, setMarkets] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [resultCode, setResultCode] = useState('')

  useEffect(() => {
    void (async () => {
      try { setPlans(await listPlatformPlans()) }
      catch (e) { message.error(e instanceof Error ? e.message : '套餐加载失败') }
    })()
  }, [])

  async function submit(values: FormValues) {
    if (values.adminPassword.length < 10) { message.error('租户后台密码至少 10 位'); return }
    setSubmitting(true)
    try {
      const res = await provisionTenant({
        code: values.code.trim().toLowerCase(),
        name: values.name.trim(),
        planCode: values.planCode,
        markets: values.markets.map((m) => ({ market: m, currency: MARKET_PRESET[m].currency, timezone: MARKET_PRESET[m].timezone })),
        domains: values.domains.map((d) => ({ domain: d.domain.trim().toLowerCase(), market: d.market })),
        adminUsername: values.adminUsername.trim(),
        adminPassword: values.adminPassword,
        poolMin: values.poolMin,
        poolMax: values.poolMax,
      })
      setResultCode(values.code.trim().toLowerCase())
      setResult(res)
    } catch (e) {
      // 开站失败的原因要原样展示：卡在建库/基线/种子表哪一步，人要能立刻知道
      message.error(e instanceof Error ? e.message : '开站失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <Result
        status={result.smoke.ok ? 'success' : 'warning'}
        title={result.smoke.ok ? `租户 ${resultCode} 已开通` : `租户 ${resultCode} 已建库，但自检未全部通过`}
        subTitle={`库 ${result.database} · 建表 ${result.tables} 张`}
        extra={[
          <Button key="detail" type="primary" onClick={() => nav(`/tenants/${result.tenantId}`)}>查看详情</Button>,
          <Button key="again" onClick={() => { setResult(null); form.resetFields(); setMarkets([]) }}>再开一个</Button>,
        ]}
      >
        <Card size="small" title="交付信息" style={{ marginBottom: 12 }}>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            业务后台入口：<Typography.Text code copyable>https://{result.adminDomain}/admin-panel/</Typography.Text>
          </Typography.Paragraph>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            平台子域名走泛解析即刻可用；客户自带域名需要客户把该地址也解析到本服务器。
          </Typography.Text>
        </Card>
        <Card size="small" title="冒烟自检">
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            dataSource={result.smoke.checks}
            columns={[
              { title: '检查项', dataIndex: 'name', width: 140 },
              { title: '结果', dataIndex: 'ok', width: 80,
                render: (ok: boolean) => ok ? <Tag color="green">通过</Tag> : <Tag color="red">未通过</Tag> },
              { title: '详情', dataIndex: 'detail' },
            ]}
          />
        </Card>
        <Card size="small" title="种子表复制情况" style={{ marginTop: 12 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            -1 表示该表复制失败，需要人工核实并补数据；其余数字是复制的行数。
          </Typography.Paragraph>
          <Space wrap>
            {Object.entries(result.seededRows).map(([table, n]) => (
              <Tag key={table} color={n < 0 ? 'red' : 'default'}>{table}: {n}</Tag>
            ))}
          </Space>
        </Card>
      </Result>
    )
  }

  return (
    <Card title="一键开站">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="开站流程：建库 → 应用结构基线 → 复制配置类种子表 → 平台库登记 → 冒烟自检"
        description="不会复制任何用户/注单/充提等业务数据；租户库与自营库表结构完全一致。整个过程通常在数十秒内完成。"
      />
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ planCode: 'standard', poolMin: 2, poolMax: 4, domains: [] }}
        onFinish={submit}
      >
        <Space size={24} align="start" wrap>
          <Form.Item name="code" label="租户代号" rules={[{ required: true }, CODE_RULE]} extra="库名将是 betogo_<代号>，创建后不可改">
            <Input placeholder="如 abcgame" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="name" label="运营商名称" rules={[{ required: true, message: '请输入运营商名称' }]}>
            <Input placeholder="如 ABC Game 运营" style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="planCode" label="套餐" rules={[{ required: true }]}>
            <Select
              style={{ width: 200 }}
              options={plans.map((p) => ({ value: p.code, label: p.name }))}
            />
          </Form.Item>
        </Space>

        <Form.Item
          name="markets"
          label="开通市场"
          rules={[{ required: true, message: '至少选择一个市场' }]}
        >
          <Checkbox.Group
            options={Object.entries(MARKET_PRESET).map(([k, v]) => ({ label: `${v.label}（${v.currency} / ${v.timezone}）`, value: k }))}
            onChange={(vals) => setMarkets(vals as string[])}
          />
        </Form.Item>

        <Form.Item label="域名" required>
          <Form.List name="domains" rules={[{
            validator: async (_, value: FormValues['domains']) => {
              if (!value || value.length === 0) return Promise.reject(new Error('至少配置一个域名'))
            },
          }]}>
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item
                      {...field}
                      name={[field.name, 'domain']}
                      rules={[{ required: true, message: '请输入域名' }]}
                    >
                      <Input placeholder="site.example.com" style={{ width: 260 }} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'market']}
                      rules={[{ required: true, message: '归属市场' }]}
                    >
                      <Select
                        placeholder="归属市场"
                        style={{ width: 140 }}
                        options={markets.map((m) => ({ value: m, label: MARKET_PRESET[m].label }))}
                      />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Form.Item>
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    disabled={markets.length === 0}
                    onClick={() => add()}
                  >
                    添加域名
                  </Button>
                  {markets.length === 0 && <Typography.Text type="secondary" style={{ marginLeft: 8 }}>先选择开通市场</Typography.Text>}
                  <Form.ErrorList errors={errors} />
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form.Item>

        <Typography.Title level={5}>租户后台超管账号</Typography.Title>
        <Space size={24} wrap>
          <Form.Item name="adminUsername" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input style={{ width: 220 }} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="adminPassword"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }, { min: 10, message: '至少 10 位' }]}
          >
            <Input.Password style={{ width: 220 }} autoComplete="new-password" />
          </Form.Item>
        </Space>

        <Typography.Title level={5}>连接池（可用默认值）</Typography.Title>
        <Space size={24}>
          <Form.Item name="poolMin" label="初始连接数">
            <InputNumber min={0} max={100} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="poolMax" label="最大连接数">
            <InputNumber min={1} max={100} style={{ width: 140 }} />
          </Form.Item>
        </Space>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} size="large">
            开站
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
