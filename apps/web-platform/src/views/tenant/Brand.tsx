import { useEffect, useState } from 'react'
import { Button, Card, Form, Input, Space, Tag, Typography, message } from 'antd'
import { getTenantBrand, saveTenantBrand, uploadBrandAsset, type TenantBrandResponse } from '../../api'
import { useTenant } from './context'

const THEME_HINT: Record<string, string> = {
  primary: '主色，如 #ffb800',
  primaryForeground: '主色上的文字色',
  accent: '强调色',
  accentForeground: '强调色上的文字色',
  radius: '圆角，如 0.75rem',
  fontSans: '正文字体，如 Nunito, sans-serif',
  fontDisplay: '标题字体',
}

const ASSET_SLOTS = [
  { slot: 'logoLight' as const, field: 'logoLightKey' as const, label: '亮色底 logo' },
  { slot: 'logoDark' as const, field: 'logoDarkKey' as const, label: '暗色底 logo' },
  { slot: 'favicon' as const, field: 'faviconKey' as const, label: 'Favicon' },
  { slot: 'appIcon' as const, field: 'appIconKey' as const, label: 'App 图标' },
]

/**
 * 品牌包。文字先于图片：包网客户开站当天往往还没有 logo 图，
 * 填个站名与文字 logo 就能先把站挂上自己的名字。
 */
export default function Brand() {
  const { d } = useTenant()
  const tenantId = d.id
  const [data, setData] = useState<TenantBrandResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    try {
      const res = await getTenantBrand(tenantId)
      setData(res)
      form.setFieldsValue({ ...res.brand, ...res.brand.theme })
    } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [tenantId])

  async function save() {
    if (!data) return
    setSaving(true)
    try {
      const v = form.getFieldsValue()
      const theme: Record<string, string> = {}
      for (const k of data.themeKeys) if (v[k]) theme[k] = String(v[k]).trim()
      await saveTenantBrand(tenantId, {
        siteName: v.siteName, shortName: v.shortName,
        logoTextPrimary: v.logoTextPrimary, logoTextAccent: v.logoTextAccent,
        tagline: v.tagline, theme,
      })
      await load()
      message.success('已保存，前台缓存已刷新')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function upload(slot: typeof ASSET_SLOTS[number]['slot'], field: typeof ASSET_SLOTS[number]['field'], file: File) {
    if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
    try {
      const { key } = await uploadBrandAsset(tenantId, slot, dataUrl)
      // 上传与落库分两步：上传只产出 key，写进哪个位置由这次保存决定，
      // 传错了不改配置就不会影响线上
      await saveTenantBrand(tenantId, { [field]: key })
      await load()
      message.success('已上传并保存')
    } catch (e) { message.error((e as Error).message) }
  }

  async function clearAsset(field: typeof ASSET_SLOTS[number]['field']) {
    try {
      await saveTenantBrand(tenantId, { [field]: null })
      await load()
      message.success('已清除')
    } catch (e) { message.error((e as Error).message) }
  }

  if (!data) return <Card size="small" loading />

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="文字与主题" size="small"
        extra={<Space>
          <Typography.Text type="secondary">
            {data.brand.updatedAt ? `更新于 ${new Date(data.brand.updatedAt).toLocaleString()}` : '未配置，前台用默认品牌'}
          </Typography.Text>
          <Button type="primary" size="small" loading={saving} onClick={() => void save()}>保存</Button>
        </Space>}>
        <Form form={form} layout="vertical" size="small">
          <Space wrap size="large" align="start">
            <Form.Item name="siteName" label="站名" tooltip="用于标题栏、版权行，并作为所有文案里的 {{brandName}}">
              <Input style={{ width: 180 }} maxLength={64} />
            </Form.Item>
            <Form.Item name="shortName" label="短名" tooltip="角标与安装引导">
              <Input style={{ width: 90 }} maxLength={32} />
            </Form.Item>
            <Form.Item name="logoTextPrimary" label="文字 logo 前段">
              <Input style={{ width: 120 }} maxLength={16} />
            </Form.Item>
            <Form.Item name="logoTextAccent" label="后段（主色）">
              <Input style={{ width: 120 }} maxLength={16} />
            </Form.Item>
            <Form.Item name="tagline" label="标语">
              <Input style={{ width: 180 }} maxLength={64} />
            </Form.Item>
          </Space>

          <Typography.Text strong>主题变量</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Space wrap size="large" align="start">
              {data.themeKeys.map((k) => (
                <Form.Item key={k} name={k} label={k} tooltip={THEME_HINT[k]}>
                  <Input style={{ width: 170 }} placeholder="留空=用默认值" allowClear />
                </Form.Item>
              ))}
            </Space>
          </div>
        </Form>
      </Card>

      <Card title="图片资产" size="small">
        <Space wrap size="large" align="start">
          {ASSET_SLOTS.map(({ slot, field, label }) => {
            const key = data.brand[field]
            return (
              <Space key={slot} direction="vertical" size={4}>
                <Typography.Text type="secondary">{label}</Typography.Text>
                {key
                  ? <img src={`${data.assetPreviewBase}${key}`} alt={label}
                      style={{ height: 40, maxWidth: 140, objectFit: 'contain', background: '#f5f5f5', padding: 4 }} />
                  : <Tag>未配置</Tag>}
                <Space size={4}>
                  <Button size="small" onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/png,image/jpeg,image/webp'
                    input.onchange = () => { const f = input.files?.[0]; if (f) void upload(slot, field, f) }
                    input.click()
                  }}>上传</Button>
                  {key && <Button size="small" danger onClick={() => void clearAsset(field)}>清除</Button>}
                </Space>
              </Space>
            )
          })}
        </Space>
      </Card>
    </Space>
  )
}
