import { useEffect, useState } from 'react'
import { Button, Card, Col, Form, Image, Input, Popconfirm, Row, Select, Space, Switch, Tabs, Typography, Upload, message, Spin } from 'antd'
import { DeleteOutlined, HomeOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  deleteHomeContentItem,
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

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function nextSlot(items: FormItemState[]): number {
  return items.reduce((max, item) => Math.max(max, item.slot), 0) + 1
}

export default function HomeContentConfig() {
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [activeKind, setActiveKind] = useState<Kind>('banner')
  const [activeBannerSlot, setActiveBannerSlot] = useState('1')
  const [activeCardSlot, setActiveCardSlot] = useState('1')
  const [banners, setBanners] = useState<FormItemState[]>([])
  const [cards, setCards] = useState<FormItemState[]>([])

  async function load() {
    setLoading(true)
    try {
      const data = await getHomeContent()
      const nextBanners = data.banners.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot)
      const nextCards = data.cards.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot)
      setBanners(nextBanners)
      setCards(nextCards)
      setActiveBannerSlot(String(nextBanners[0]?.slot ?? 1))
      setActiveCardSlot(String(nextCards[0]?.slot ?? 1))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function itemsOf(kind: Kind) {
    return kind === 'banner' ? banners : cards
  }

  function setItemsOf(kind: Kind, updater: (items: FormItemState[]) => FormItemState[]) {
    const setter = kind === 'banner' ? setBanners : setCards
    setter((prev) => updater(prev).sort((a, b) => a.slot - b.slot))
  }

  function activeSlotOf(kind: Kind) {
    return kind === 'banner' ? activeBannerSlot : activeCardSlot
  }

  function setActiveSlotOf(kind: Kind, slot: string) {
    if (kind === 'banner') setActiveBannerSlot(slot)
    else setActiveCardSlot(slot)
  }

  function updateItem(kind: Kind, slot: number, patch: Partial<FormItemState>) {
    setItemsOf(kind, (prev) => prev.map((item) => item.slot === slot ? { ...item, ...patch } : item))
  }

  function handleAdd(kind: Kind) {
    const slot = nextSlot(itemsOf(kind))
    setItemsOf(kind, (prev) => [...prev, emptyItem(kind, slot)])
    setActiveSlotOf(kind, String(slot))
  }

  async function handleDelete(item: FormItemState) {
    if (item.imageKey) {
      await deleteHomeContentItem(item.kind, item.slot)
    }
    setItemsOf(item.kind, (prev) => {
      const next = prev.filter((entry) => entry.slot !== item.slot)
      setActiveSlotOf(item.kind, String(next[0]?.slot ?? 1))
      return next
    })
    message.success('已删除')
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
    const ratioText = item.kind === 'banner'
      ? '推荐尺寸：1280 x 720（16:9，与首页 banner 区块一致），PNG/JPG/WEBP，≤5MB'
      : '推荐尺寸：444 x 240（约 1.85:1，与首页彩色小卡片区块一致），PNG/JPG/WEBP，≤5MB'
    return (
      <Card
        size="small"
        extra={
          <Space>
            <Switch
              checkedChildren="启用"
              unCheckedChildren="关闭"
              checked={item.enabled}
              onChange={(enabled) => updateItem(item.kind, item.slot, { enabled })}
            />
            <Popconfirm title="确定删除这一项？" onConfirm={() => void handleDelete(item)}>
              <Button danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text type="secondary">{ratioText}</Text>
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              height={item.kind === 'banner' ? 220 : 160}
              style={{ width: '100%', objectFit: 'cover', borderRadius: 6, background: '#111827' }}
            />
          ) : (
            <div style={{ height: item.kind === 'banner' ? 220 : 160, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
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
    )
  }

  function renderKind(kind: Kind) {
    const items = itemsOf(kind)
    const activeSlot = activeSlotOf(kind)
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd(kind)}>
          新增{kind === 'banner' ? 'Banner' : '小卡片'}
        </Button>
        {items.length === 0 ? (
          <Card>
            <Text type="secondary">暂无内容，点击上方按钮新增。</Text>
          </Card>
        ) : (
          <Tabs
            type="card"
            activeKey={items.some((item) => String(item.slot) === activeSlot) ? activeSlot : String(items[0].slot)}
            onChange={(key) => setActiveSlotOf(kind, key)}
            items={items.map((item) => ({
              key: String(item.slot),
              label: `${kind === 'banner' ? 'Banner' : '小卡片'} ${item.slot}`,
              children: renderEditor(item),
            }))}
          />
        )}
      </Space>
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

      <Tabs
        activeKey={activeKind}
        onChange={(key) => setActiveKind(key as Kind)}
        items={[
          { key: 'banner', label: 'Banner', children: renderKind('banner') },
          { key: 'card', label: '首页彩色小卡片', children: renderKind('card') },
        ]}
      />
    </div>
  )
}
