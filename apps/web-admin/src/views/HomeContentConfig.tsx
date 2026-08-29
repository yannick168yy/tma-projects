import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, DatePicker, Form, Image, Input, Popconfirm, Row, Select, Space, Switch, Tabs, Typography, Upload, message, Spin } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HomeOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { UploadFile } from 'antd'
import {
  deleteHomeContentItem,
  getAnnouncements,
  getHomeContent,
  saveAnnouncement,
  saveHomeContentItem,
  saveHomeContentLocalizedImage,
  translateCsContent,
  uploadHomeImage,
  type AdminAnnouncement,
  type AnnouncementPlacement,
  type HomeContentItem,
} from '../api'

const { Title, Text } = Typography

type Kind = HomeContentItem['kind']
type HomeContentTab = Kind | 'announcements'

interface FormItemState {
  kind: Kind
  slot: number
  imageKey: string
  imageUrl: string
  imageKeys: Record<string, string>
  imageUrls: Record<string, string>
  actionType: HomeContentItem['actionType']
  actionValue: string | null
  enabled: boolean
  imageMissing?: boolean
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
  return { kind, slot, imageKey: '', imageUrl: '', imageKeys: {}, imageUrls: {}, actionType: 'none', actionValue: null, enabled: true }
}

const announcementLabels: Record<AnnouncementPlacement, { title: string; position: string }> = {
  top_marquee: {
    title: '紧急公告',
    position: '显示在前台顶部菜单栏下方，使用通栏跑马灯效果',
  },
  home_banner_top: {
    title: '一般公告',
    position: '显示在首页 Banner 上方',
  },
}

const emptyAnnouncements: AdminAnnouncement[] = [
  { placement: 'top_marquee', enabled: false, contents: { en: '', zh: '', id: '', vi: '' }, startsAt: null, endsAt: null, updatedAt: '' },
  { placement: 'home_banner_top', enabled: false, contents: { en: '', zh: '', id: '', vi: '' }, startsAt: null, endsAt: null, updatedAt: '' },
]

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
  const [activeKind, setActiveKind] = useState<HomeContentTab>('banner')
  const [activeBannerSlot, setActiveBannerSlot] = useState('1')
  const [activeWalletBannerSlot, setActiveWalletBannerSlot] = useState('1')
  const [imageLocale, setImageLocale] = useState('en')
  const [banners, setBanners] = useState<FormItemState[]>([])
  const [walletBanners, setWalletBanners] = useState<FormItemState[]>([])
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>(emptyAnnouncements)
  const [translatingAnnouncement, setTranslatingAnnouncement] = useState<AnnouncementPlacement | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [data, announcementData] = await Promise.all([getHomeContent(), getAnnouncements()])
      const nextBanners = data.banners.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot)
      const nextWalletBanners = data.walletBanners.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot)
      setBanners(nextBanners)
      setWalletBanners(nextWalletBanners)
      setActiveBannerSlot(String(nextBanners[0]?.slot ?? 1))
      setActiveWalletBannerSlot(String(nextWalletBanners[0]?.slot ?? 1))
      setAnnouncements(emptyAnnouncements.map((fallback) => announcementData.items.find((item) => item.placement === fallback.placement) ?? fallback))
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

  function updateAnnouncement(placement: AnnouncementPlacement, patch: Partial<AdminAnnouncement>) {
    setAnnouncements((prev) => prev.map((item) => item.placement === placement ? { ...item, ...patch } : item))
  }

  async function handleSaveAnnouncement(item: AdminAnnouncement) {
    setSavingKey(`announcement-${item.placement}`)
    try {
      await saveAnnouncement({
        placement: item.placement,
        enabled: item.enabled,
        contents: item.contents,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      })
      message.success('已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingKey('')
    }
  }

  async function handleTranslateAnnouncement(item: AdminAnnouncement) {
    const source = item.contents.zh.trim() || item.contents.en.trim()
    if (!source) {
      message.warning('请先填写中文或英文公告原文')
      return
    }
    setTranslatingAnnouncement(item.placement)
    try {
      const result = await translateCsContent([source], 'id')
      updateAnnouncement(item.placement, { contents: { ...item.contents, id: result.items[0] } })
      message.success('已翻译为印尼语，请确认后保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '翻译失败')
    } finally {
      setTranslatingAnnouncement(null)
    }
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
      const uploaded = await uploadHomeImage(kind, imageData, imageLocale)
      const item = itemsOf(kind).find((entry) => entry.slot === slot)
      const imageKeys = { ...(item?.imageKeys ?? {}), [imageLocale]: uploaded.imageKey }
      const imageUrls = { ...(item?.imageUrls ?? {}), [imageLocale]: uploaded.imageUrl }
      updateItem(kind, slot, imageLocale === 'en'
        ? { ...uploaded, imageKeys, imageUrls, imageMissing: false }
        : { imageKeys, imageUrls })
      message.success('图片已上传，请保存设置')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败')
    }
  }

  async function handleSave(item: FormItemState) {
    const selectedImageKey = item.imageKeys[imageLocale] ?? (imageLocale === 'en' ? item.imageKey : '')
    if (!selectedImageKey) {
      message.warning(`请先上传 ${imageLocale} 图片`)
      return
    }
    const key = `${item.kind}-${item.slot}`
    setSavingKey(key)
    try {
      if (imageLocale === 'en') {
        await saveHomeContentItem({
          kind: item.kind,
          slot: item.slot,
          imageKey: selectedImageKey,
          actionType: item.actionType,
          actionValue: item.actionValue,
          enabled: item.enabled,
        })
      } else {
        if (!item.imageKey) throw new Error('请先保存英文默认图片')
        await saveHomeContentItem({
          kind: item.kind,
          slot: item.slot,
          imageKey: item.imageKey,
          actionType: item.actionType,
          actionValue: item.actionValue,
          enabled: item.enabled,
        })
        await saveHomeContentLocalizedImage(item.kind, item.slot, imageLocale, selectedImageKey)
      }
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
      imageKeys: x.imageKeys, imageUrls: x.imageUrls,
      actionType: x.actionType, actionValue: x.actionValue, enabled: x.enabled,
    })
    const aContent = content(a)
    const bContent = content(b)
    setSavingKey(`move-${item.kind}-${item.slot}`)
    try {
      await saveHomeContentItem({ kind: a.kind, slot: a.slot, ...bContent })
      await saveHomeContentItem({ kind: b.kind, slot: b.slot, ...aContent })
      for (const locale of ['id', 'vi', 'zh-CN']) {
        await saveHomeContentLocalizedImage(a.kind, a.slot, locale, bContent.imageKeys[locale] ?? null)
        await saveHomeContentLocalizedImage(b.kind, b.slot, locale, aContent.imageKeys[locale] ?? null)
      }
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
          <Select
            value={imageLocale}
            style={{ width: 220 }}
            options={[
              { value: 'en', label: '英文 / 默认图片' },
              { value: 'id', label: '印尼语图片' },
              { value: 'vi', label: '越南语图片' },
              { value: 'zh-CN', label: '中文图片' },
            ]}
            onChange={setImageLocale}
          />
          {item.imageMissing && (
            <Alert
              type="error"
              showIcon
              message="图片文件已丢失"
              description="配置仍在，但服务器上的图片文件不存在（可能被部署清理），前台不会显示该 Banner。请重新上传图片并点击「保存设置」。"
            />
          )}
          {item.imageMissing ? (
            <div style={{ height: item.kind === 'banner' ? 220 : 140, border: '1px dashed #ff4d4f', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff4d4f', background: '#fff1f0' }}>
              图片文件已丢失，请重新上传
            </div>
          ) : (item.imageUrls[imageLocale] ?? (imageLocale === 'en' ? item.imageUrl : '')) ? (
            <Image
              src={item.imageUrls[imageLocale] ?? item.imageUrl}
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
              <Input value={item.imageKeys[imageLocale] ?? (imageLocale === 'en' ? item.imageKey : '')} readOnly placeholder="上传后自动生成" />
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

  function renderAnnouncements() {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {announcements.map((item) => {
          const meta = announcementLabels[item.placement]
          return (
            <Card
              key={item.placement}
              title={meta.title}
              extra={
                <Switch
                  checkedChildren="启用"
                  unCheckedChildren="关闭"
                  checked={item.enabled}
                  onChange={(enabled) => updateAnnouncement(item.placement, { enabled })}
                />
              }
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert type="info" showIcon message={meta.position} />
                <Form layout="vertical" requiredMark={false}>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item label="开始时间（可选）" style={{ marginBottom: 12 }}>
                        <DatePicker
                          showTime
                          allowClear
                          style={{ width: '100%' }}
                          value={item.startsAt ? dayjs(item.startsAt) : null}
                          onChange={(value) => updateAnnouncement(item.placement, { startsAt: value ? value.toISOString() : null })}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="结束时间（可选）" style={{ marginBottom: 12 }}>
                        <DatePicker
                          showTime
                          allowClear
                          style={{ width: '100%' }}
                          value={item.endsAt ? dayjs(item.endsAt) : null}
                          onChange={(value) => updateAnnouncement(item.placement, { endsAt: value ? value.toISOString() : null })}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item label="英文" style={{ marginBottom: 12 }}>
                        <Input.TextArea
                          rows={3}
                          value={item.contents.en}
                          onChange={(e) => updateAnnouncement(item.placement, { contents: { ...item.contents, en: e.target.value } })}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="中文" style={{ marginBottom: 12 }}>
                        <Input.TextArea
                          rows={3}
                          value={item.contents.zh}
                          onChange={(e) => updateAnnouncement(item.placement, { contents: { ...item.contents, zh: e.target.value } })}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="印尼语" style={{ marginBottom: 12 }}>
                        <Input.TextArea
                          rows={3}
                          value={item.contents.id}
                          onChange={(e) => updateAnnouncement(item.placement, { contents: { ...item.contents, id: e.target.value } })}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="越南语" style={{ marginBottom: 12 }}>
                        <Input.TextArea
                          rows={3}
                          value={item.contents.vi}
                          onChange={(e) => updateAnnouncement(item.placement, { contents: { ...item.contents, vi: e.target.value } })}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
                <Space>
                  <Button
                    loading={translatingAnnouncement === item.placement}
                    onClick={() => void handleTranslateAnnouncement(item)}
                  >
                    AI 翻译印尼语
                  </Button>
                  <Button
                    type="primary"
                    loading={savingKey === `announcement-${item.placement}`}
                    onClick={() => void handleSaveAnnouncement(item)}
                  >
                    保存公告
                  </Button>
                </Space>
              </Space>
            </Card>
          )
        })}
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
        onChange={(key) => setActiveKind(key as HomeContentTab)}
        items={[
          { key: 'banner', label: 'Banner', children: renderKind('banner') },
          { key: 'announcements', label: '公告', children: renderAnnouncements() },
          { key: 'wallet_banner', label: '充值/提现 Banner', children: renderKind('wallet_banner') },
        ]}
      />
    </div>
  )
}
