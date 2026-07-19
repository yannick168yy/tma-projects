import { useEffect, useState } from 'react'
import { Button, Card, Col, Form, Image, Input, Popconfirm, Row, Select, Space, Switch, Tabs, Typography, Upload, message, Spin } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HomeOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  deleteHomeContentItem,
  getHomeContent,
  saveHomeContentItem,
  uploadHomeImage,
  type HomeContentItem,
} from '../api'

const { Title, Text } = Typography

type Kind = HomeContentItem['kind']

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
  { label: '首席体验官', value: 'trial' },
]

// VIP 页二级 tab（与前端 VipPage 的 VIP_TABS 一致）
const vipTabOptions = [
  { label: '总览', value: 'overview' },
  { label: '负盈利返水', value: 'lossrebate' },
  { label: '权益', value: 'benefits' },
  { label: '记录', value: 'records' },
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
  { label: 'VIP 中心', value: '/vip' },
  { label: '任务中心', value: '/tasks' },
  { label: '充值窗口', value: '/deposit' },
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

function itemToVipTab(item: FormItemState): string | undefined {
  if (item.actionType === 'path' && (item.actionValue ?? '').startsWith('/vip?tab=')) {
    return new URLSearchParams((item.actionValue ?? '').split('?')[1]).get('tab') ?? undefined
  }
  return undefined
}

// 目标下拉 → 存储用的 actionType/actionValue（sub = 二级选项：优惠区块 或 VIP 页签）
function destToAction(dest: string, sub?: string): Pick<FormItemState, 'actionType' | 'actionValue'> {
  if (dest === 'none') return { actionType: 'none', actionValue: null }
  if (dest === 'url') return { actionType: 'url', actionValue: '' }
  if (dest === '/bonuses') return { actionType: 'path', actionValue: sub ? `/bonuses?promo=${sub}` : '/bonuses' }
  if (dest === '/vip') return { actionType: 'path', actionValue: sub ? `/vip?tab=${sub}` : '/vip' }
  return { actionType: 'path', actionValue: dest }
}

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
  const [activeWalletBannerSlot, setActiveWalletBannerSlot] = useState('1')
  const [banners, setBanners] = useState<FormItemState[]>([])
  const [walletBanners, setWalletBanners] = useState<FormItemState[]>([])

  async function load() {
    setLoading(true)
    try {
      const data = await getHomeContent()
      const nextBanners = data.banners.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot)
      const nextWalletBanners = data.walletBanners.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot)
      setBanners(nextBanners)
      setWalletBanners(nextWalletBanners)
      setActiveBannerSlot(String(nextBanners[0]?.slot ?? 1))
      setActiveWalletBannerSlot(String(nextWalletBanners[0]?.slot ?? 1))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function itemsOf(kind: Kind) {
    if (kind === 'banner') return banners
    return walletBanners
  }

  function setItemsOf(kind: Kind, updater: (items: FormItemState[]) => FormItemState[]) {
    const setter = kind === 'banner' ? setBanners : setWalletBanners
    setter((prev) => updater(prev).sort((a, b) => a.slot - b.slot))
  }

  function activeSlotOf(kind: Kind) {
    if (kind === 'banner') return activeBannerSlot
    return activeWalletBannerSlot
  }

  function setActiveSlotOf(kind: Kind, slot: string) {
    if (kind === 'banner') setActiveBannerSlot(slot)
    else setActiveWalletBannerSlot(slot)
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
        enabled: item.enabled,
      })
      message.success('已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingKey('')
    }
  }

  // 调整位置：slot 号即位置（前端按 slot 升序展示），移动 = 把相邻两个 slot 承载的内容对调，
  // slot 本身不变，避开主键冲突，复用现有 save 接口写两次。
  async function handleMove(item: FormItemState, dir: 'up' | 'down') {
    const items = itemsOf(item.kind)
    const idx = items.findIndex((i) => i.slot === item.slot)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= items.length) return
    const a = items[idx]
    const b = items[swapIdx]
    if (!a.imageKey || !b.imageKey) {
      message.warning('请先给两个 Banner 都上传并保存图片后再调整位置')
      return
    }
    const content = (x: FormItemState) => ({
      imageKey: x.imageKey, imageUrl: x.imageUrl,
      actionType: x.actionType, actionValue: x.actionValue, enabled: x.enabled,
    })
    const aContent = content(a)
    const bContent = content(b)
    setSavingKey(`move-${item.kind}-${item.slot}`)
    try {
      await saveHomeContentItem({ kind: a.kind, slot: a.slot, ...bContent })
      await saveHomeContentItem({ kind: b.kind, slot: b.slot, ...aContent })
      setItemsOf(item.kind, (prev) => prev.map((x) => {
        if (x.slot === a.slot) return { ...x, ...bContent }
        if (x.slot === b.slot) return { ...x, ...aContent }
        return x
      }))
      setActiveSlotOf(item.kind, String(b.slot)) // 跟随被移动的 banner
      message.success('位置已调整')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '调整失败')
      void load() // 失败可能半交换，重新拉取纠正本地状态
    } finally {
      setSavingKey('')
    }
  }

  function renderEditor(item: FormItemState) {
    const siblings = itemsOf(item.kind)
    const pos = siblings.findIndex((i) => i.slot === item.slot)
    const isFirst = pos <= 0
    const isLast = pos === siblings.length - 1
    const moving = savingKey === `move-${item.kind}-${item.slot}`
    const ratioText =
      item.kind === 'banner'
        ? '推荐尺寸：1280 x 720（16:9，与首页 banner 区块一致），PNG/JPG/WEBP，≤5MB'
        : '推荐尺寸：824 x 205（约 4:1，用于充值/提现窗口），PNG/JPG/WEBP，≤5MB'
    return (
      <Card
        size="small"
        extra={
          <Space>
            <Button
              icon={<ArrowUpOutlined />}
              disabled={isFirst || moving}
              loading={moving}
              onClick={() => void handleMove(item, 'up')}
              title="上移"
            >上移</Button>
            <Button
              icon={<ArrowDownOutlined />}
              disabled={isLast || moving}
              onClick={() => void handleMove(item, 'down')}
              title="下移"
            >下移</Button>
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
              height={item.kind === 'banner' ? 220 : 140}
              style={{ width: '100%', objectFit: 'cover', borderRadius: 6, background: '#111827' }}
            />
          ) : (
            <div style={{ height: item.kind === 'banner' ? 220 : 140, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
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
            {item.kind !== 'wallet_banner' && (() => {
              const dest = itemToDest(item)
              const promo = itemToPromo(item)
              const vipTab = itemToVipTab(item)
              const hasSub = dest === '/bonuses' || dest === 'url' || dest === '/vip'
              return (
                <Row gutter={12}>
                  <Col span={hasSub ? 12 : 24}>
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
                  {dest === '/vip' && (
                    <Col span={12}>
                      <Form.Item label="VIP 页签（可选）" style={{ marginBottom: 8 }}>
                        <Select
                          allowClear
                          value={vipTab}
                          options={vipTabOptions}
                          placeholder="不指定则停在总览"
                          onChange={(tab) => updateItem(item.kind, item.slot, destToAction('/vip', tab))}
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
          新增{kind === 'banner' ? 'Banner' : '充值/提现 Banner'}
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
            items={items.map((item, index) => ({
              key: String(item.slot),
              label: `${kind === 'banner' ? 'Banner' : '充值/提现 Banner'} ${index + 1}`,
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
        <Text type="secondary" style={{ fontSize: 13 }}>设置首页 banner 和充值/提现窗口 banner 图片</Text>
      </div>

      <Tabs
        activeKey={activeKind}
        onChange={(key) => setActiveKind(key as Kind)}
        items={[
          { key: 'banner', label: 'Banner', children: renderKind('banner') },
          { key: 'wallet_banner', label: '充值/提现 Banner', children: renderKind('wallet_banner') },
        ]}
      />
    </div>
  )
}
