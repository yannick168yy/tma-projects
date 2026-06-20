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
  valueText: string | null
  labelText: string | null
  enabled: boolean
}

// 前台小卡片固定背景皮肤（与 web-tma HomeCategoryShortcut 保持一致），用于后台预览
const CARD_SKIN: React.CSSProperties = {
  background: 'radial-gradient(120% 120% at 0% 0%, #5b3fa0 0%, #382a6b 45%, #271d52 100%)',
  boxShadow: '0 6px 14px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
}

const promoOptions = [
  { label: '首充嘉年华', value: 'firstdep' },
  { label: '邀请共赢', value: 'referral' },
  { label: '首席体验官', value: 'trial' },
]

// 跳转目标 = 前台路由 path（'none' 不跳转，'url' 外链）。优惠页可再选具体优惠区块。
const destinations = [
  { label: '无跳转', value: 'none' },
  { label: '首页', value: '/casino' },
  { label: '优惠页（Bonuses）', value: '/bonuses' },
  { label: 'Bingo 宾果', value: '/bingo' },
  { label: '老虎机大厅', value: '/slots' },
  { label: '洗码返水页', value: '/cashback' },
  { label: '幸运转盘', value: '/rewards-spin' },
  { label: '团队中心', value: '/team' },
  { label: '代理中心', value: '/agent' },
  { label: '推荐返利', value: '/referral' },
  { label: '投注记录', value: '/bet-history' },
  { label: '奖励记录', value: '/rewards' },
  { label: '菜单', value: '/menu' },
  { label: '外部链接', value: 'url' },
]
const destValues = new Set(destinations.map((d) => d.value))

// 旧类型(promo/cashback/spin/lobby)与新 path/url 统一映射到目标下拉
function itemToDest(item: FormItemState): string {
  switch (item.actionType) {
    case 'none': return 'none'
    case 'url': return 'url'
    case 'promo': return '/bonuses'
    case 'cashback': return '/cashback'
    case 'spin': return '/rewards-spin'
    case 'lobby': return '/slots'
    case 'path': {
      const base = (item.actionValue ?? '').split('?')[0]
      return destValues.has(base) ? base : 'none'
    }
    default: return 'none'
  }
}

function itemToPromo(item: FormItemState): string | undefined {
  if (item.actionType === 'promo') return item.actionValue ?? undefined
  if (item.actionType === 'path' && (item.actionValue ?? '').startsWith('/bonuses?promo=')) {
    return new URLSearchParams((item.actionValue ?? '').split('?')[1]).get('promo') ?? undefined
  }
  return undefined
}

// 目标下拉 → 存储用的 actionType/actionValue
function destToAction(dest: string, promo?: string): Pick<FormItemState, 'actionType' | 'actionValue'> {
  if (dest === 'none') return { actionType: 'none', actionValue: null }
  if (dest === 'url') return { actionType: 'url', actionValue: '' }
  if (dest === '/bonuses') return { actionType: 'path', actionValue: promo ? `/bonuses?promo=${promo}` : '/bonuses' }
  return { actionType: 'path', actionValue: dest }
}

function emptyItem(kind: Kind, slot: number): FormItemState {
  return { kind, slot, imageKey: '', imageUrl: '', actionType: 'none', actionValue: null, valueText: null, labelText: null, enabled: true }
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
        actionValue: item.actionValue,
        valueText: item.kind === 'card' ? item.valueText : null,
        labelText: item.kind === 'card' ? item.labelText : null,
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
      : '卡片背景与排版已固定，只需上传图标 + 填写文字。图标建议：120 x 120 透明背景 PNG/WEBP，≤5MB'
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
          {item.kind === 'banner' ? (
            item.imageUrl ? (
              <Image
                src={item.imageUrl}
                height={220}
                style={{ width: '100%', objectFit: 'cover', borderRadius: 6, background: '#111827' }}
              />
            ) : (
              <div style={{ height: 220, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                未上传图片
              </div>
            )
          ) : (
            // 小卡片：固定背景皮肤 + 图标 + 文字 的实时预览（与前台 1:1）
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', background: '#0f1117', borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 160, height: 80, borderRadius: 16, padding: '0 11px', overflow: 'hidden', ...CARD_SKIN }}>
                {item.imageUrl
                  ? <img src={item.imageUrl} alt="" style={{ width: 43, height: 43, objectFit: 'contain', flexShrink: 0 }} />
                  : <div style={{ width: 43, height: 43, borderRadius: 10, flexShrink: 0, border: '1px dashed rgba(255,255,255,0.25)' }} />}
                <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                  <div style={{ fontSize: 17, fontWeight: 900, color: '#fcd34d', textShadow: '0 1px 2px rgba(0,0,0,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.valueText || '1.50%'}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.labelText || '返水中心'}</div>
                </div>
              </div>
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
            <Button icon={<UploadOutlined />}>{item.kind === 'banner' ? '上传图片' : '上传图标'}</Button>
          </Upload>
          <Form layout="vertical" requiredMark={false}>
            {(() => {
              const dest = itemToDest(item)
              const promo = itemToPromo(item)
              return (
                <Row gutter={12}>
                  <Col span={dest === '/bonuses' || dest === 'url' ? 12 : 24}>
                    <Form.Item label="点击跳转" style={{ marginBottom: 8 }}>
                      <Select
                        value={dest}
                        options={destinations}
                        onChange={(d) => updateItem(item.kind, item.slot, destToAction(d))}
                      />
                    </Form.Item>
                  </Col>
                  {dest === '/bonuses' && (
                    <Col span={12}>
                      <Form.Item label="优惠区块（可选）" style={{ marginBottom: 8 }}>
                        <Select
                          allowClear
                          value={promo}
                          options={promoOptions}
                          placeholder="不指定则停在优惠页顶部"
                          onChange={(p) => updateItem(item.kind, item.slot, destToAction('/bonuses', p))}
                        />
                      </Form.Item>
                    </Col>
                  )}
                  {dest === 'url' && (
                    <Col span={12}>
                      <Form.Item label="外部链接" style={{ marginBottom: 8 }}>
                        <Input
                          value={item.actionValue ?? ''}
                          placeholder="https://..."
                          onChange={(e) => updateItem(item.kind, item.slot, { actionType: 'url', actionValue: e.target.value })}
                        />
                      </Form.Item>
                    </Col>
                  )}
                </Row>
              )
            })()}
            {item.kind === 'card' && (
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="数值文案（金色）" style={{ marginBottom: 8 }}>
                    <Input
                      value={item.valueText ?? ''}
                      maxLength={32}
                      placeholder="如 1.50% / ₱15,780 / 120%"
                      onChange={(e) => updateItem(item.kind, item.slot, { valueText: e.target.value })}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="标签文案（浅色）" style={{ marginBottom: 8 }}>
                    <Input
                      value={item.labelText ?? ''}
                      maxLength={32}
                      placeholder="如 返水中心 / 奖励转盘"
                      onChange={(e) => updateItem(item.kind, item.slot, { labelText: e.target.value })}
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
            <Form.Item label={item.kind === 'banner' ? '图片 key' : '图标 key'} style={{ marginBottom: 8 }}>
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
