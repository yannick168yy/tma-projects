import { useEffect, useState } from 'react'
import { Button, Card, Col, Form, Image, Input, Row, Select, Space, Switch, Typography, Upload, message, Spin } from 'antd'
import { HomeOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  getHomeContent,
  saveHomeContentItem,
  uploadHomeImage,
  type HomeContentItem,
} from '../api'

const { Title, Text } = Typography

type Kind = 'banner' | 'card'

interface FormItemState {
  kind: Kind
  slot: number
  imageKey: string
  imageUrl: string
  actionType: HomeContentItem['actionType']
  actionValue: string | null
  enabled: boolean
}

const promoOptions = [
  { label: '首充嘉年华', value: 'firstdep' },
  { label: '邀请共赢', value: 'referral' },
  { label: '首席体验官', value: 'trial' },
]

const actionOptions = [
  { label: '无跳转', value: 'none' },
  { label: '活动页', value: 'promo' },
  { label: '洗码页', value: 'cashback' },
  { label: '转盘页', value: 'spin' },
  { label: '游戏大厅', value: 'lobby' },
]

function emptyItem(kind: Kind, slot: number): FormItemState {
  return { kind, slot, imageKey: '', imageUrl: '', actionType: 'none', actionValue: null, enabled: true }
}

function mergeItems(kind: Kind, count: number, items: HomeContentItem[]): FormItemState[] {
  return Array.from({ length: count }, (_, index) => {
    const slot = index + 1
    const item = items.find((i) => i.slot === slot)
    return item ? { ...item } : emptyItem(kind, slot)
  })
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function HomeContentConfig() {
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [banners, setBanners] = useState<FormItemState[]>([])
  const [cards, setCards] = useState<FormItemState[]>([])

  async function load() {
    setLoading(true)
    try {
      const data = await getHomeContent()
      setBanners(mergeItems('banner', 4, data.banners))
      setCards(mergeItems('card', 6, data.cards))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function updateItem(kind: Kind, slot: number, patch: Partial<FormItemState>) {
    const setter = kind === 'banner' ? setBanners : setCards
    setter((prev) => prev.map((item) => item.slot === slot ? { ...item, ...patch } : item))
  }

  async function handleUpload(kind: Kind, slot: number, file: File) {
    try {
      const imageData = await readFileDataUrl(file)
      const uploaded = await uploadHomeImage(kind, imageData)
      updateItem(kind, slot, uploaded)
      message.success('图片已上传，请保存设置')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败')
    }
  }

  async function handleSave(item: FormItemState) {
    if (!item.imageKey) {
      message.warning('请先上传图片')
      return
    }
    const key = `${item.kind}-${item.slot}`
    setSavingKey(key)
    try {
      await saveHomeContentItem({
        kind: item.kind,
        slot: item.slot,
        imageKey: item.imageKey,
        actionType: item.actionType,
        actionValue: item.actionType === 'promo' ? item.actionValue : null,
        enabled: item.enabled,
      })
      message.success('已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingKey('')
    }
  }

  function renderEditor(item: FormItemState) {
    const title = item.kind === 'banner' ? `Banner ${item.slot}` : `首页小卡片 ${item.slot}`
    const ratioText = item.kind === 'banner'
      ? '推荐尺寸：1959 x 803，PNG/JPG/WEBP，≤5MB'
      : '推荐尺寸：543 x 330，PNG/JPG/WEBP，≤5MB'
    return (
      <Col span={item.kind === 'banner' ? 24 : 12} key={`${item.kind}-${item.slot}`}>
        <Card
          title={title}
          size="small"
          extra={
            <Switch
              checkedChildren="启用"
              unCheckedChildren="关闭"
              checked={item.enabled}
              onChange={(enabled) => updateItem(item.kind, item.slot, { enabled })}
            />
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Text type="secondary">{ratioText}</Text>
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                height={item.kind === 'banner' ? 160 : 120}
                style={{ width: '100%', objectFit: 'cover', borderRadius: 6, background: '#111827' }}
              />
            ) : (
              <div style={{ height: item.kind === 'banner' ? 160 : 120, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                未上传图片
              </div>
            )}
            <Upload
              accept="image/png,image/jpeg,image/webp"
              maxCount={1}
              fileList={[] as UploadFile[]}
              beforeUpload={(file) => {
                void handleUpload(item.kind, item.slot, file)
                return false
              }}
            >
              <Button icon={<UploadOutlined />}>上传图片</Button>
            </Upload>
            <Form layout="vertical" requiredMark={false}>
              <Row gutter={12}>
                <Col span={item.actionType === 'promo' ? 12 : 24}>
                  <Form.Item label="点击跳转" style={{ marginBottom: 8 }}>
                    <Select
                      value={item.actionType}
                      options={actionOptions}
                      onChange={(actionType) => updateItem(item.kind, item.slot, { actionType, actionValue: actionType === 'promo' ? item.actionValue : null })}
                    />
                  </Form.Item>
                </Col>
                {item.actionType === 'promo' && (
                  <Col span={12}>
                    <Form.Item label="活动类型" style={{ marginBottom: 8 }}>
                      <Select
                        value={item.actionValue ?? undefined}
                        options={promoOptions}
                        placeholder="请选择"
                        onChange={(actionValue) => updateItem(item.kind, item.slot, { actionValue })}
                      />
                    </Form.Item>
                  </Col>
                )}
              </Row>
              <Form.Item label="图片 key" style={{ marginBottom: 8 }}>
                <Input value={item.imageKey} readOnly placeholder="上传后自动生成" />
              </Form.Item>
            </Form>
            <Button
              type="primary"
              loading={savingKey === `${item.kind}-${item.slot}`}
              onClick={() => void handleSave(item)}
            >
              保存设置
            </Button>
          </Space>
        </Card>
      </Col>
    )
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <HomeOutlined style={{ fontSize: 20, color: '#1677ff' }} />
        <Title level={4} style={{ margin: 0 }}>首页装修</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>设置首页 banner 和彩色小卡片图片</Text>
      </div>

      <Title level={5}>Banner</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {banners.map(renderEditor)}
      </Row>

      <Title level={5}>首页彩色小卡片</Title>
      <Row gutter={[16, 16]}>
        {cards.map(renderEditor)}
      </Row>
    </div>
  )
}
