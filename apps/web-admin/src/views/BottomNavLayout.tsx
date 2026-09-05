import { useCallback, useEffect, useRef, useState } from 'react'
import { HolderOutlined } from '@ant-design/icons'
import { Alert, Button, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { getBottomNav, putBottomNav, type BottomNavCatalog, type BottomNavItem } from '../api'

const { Title } = Typography

const TARGET_LABEL: Record<string, string> = {
  '/home': '首页', '/games': '游戏大厅', '/bonuses': '优惠中心', '/menu': '我的菜单',
  '/team': '三圈团队', '/agent': '代理中心', '/vip': 'VIP 中心', '/rebate': '洗码返水',
  '/tasks': '任务中心', '/rewards-spin': '转盘抽奖', '/download': 'APP 下载', '/perya': 'Perya',
  '/search': '搜索',
}

/**
 * 底部导航配置（P3-2）。
 *
 * 槽位不可增删：每个槽位背后是一个已存在的页面组件，凭空多一个 id 不会有页面跟着长出来。
 * 想换内容就把某个槽位指向另一个已有页面。
 */
export default function BottomNavLayout() {
  const [data, setData] = useState<BottomNavCatalog | null>(null)
  const [rows, setRows] = useState<BottomNavItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBottomNav()
      setData(res)
      setRows(res.items)
      setDirty(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const mutate = (next: BottomNavItem[]) => { setRows(next); setDirty(true) }
  const patch = (i: number, p: Partial<BottomNavItem>) =>
    mutate(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))

  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const drop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from === null || from === to) return
    const next = [...rows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    mutate(next)
  }

  const slotOf = (id: string) => data?.slots.find((s) => s.id === id)

  const save = async () => {
    setSaving(true)
    try {
      const res = await putBottomNav(rows.map((r) => ({
        navId: r.id, hidden: r.hidden, icon: r.icon, targetPath: r.targetPath,
      })))
      setData(res)
      setRows(res.items)
      setDirty(false)
      message.success('已保存，前台下次进站生效（bootstrap 时下发）')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <Title level={4} style={{ margin: 0 }}>底部导航</Title>
        <Space>
          {dirty && <Tag color="orange">未保存</Tag>}
          <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存并生效</Button>
        </Space>
      </Space>

      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="拖动行调整底栏顺序，可改每个槽位的图标与点击后去哪个页面"
        description="槽位数量固定（5 个）：每个槽位背后是一个已有页面，加不出新页面。文案走「平台文案覆盖」里的 nav.* 条目，不在这里改。三圈是设计上的中央凸起按钮，改它的图标不生效。" />

      <Table<BottomNavItem> rowKey="id" size="small" loading={loading} pagination={false} dataSource={rows}
        onRow={(_, index) => ({
          draggable: true,
          onDragStart: () => { dragFrom.current = index ?? null },
          onDragOver: (e) => { e.preventDefault(); setDragOver(index ?? null) },
          onDragLeave: () => setDragOver((cur) => (cur === index ? null : cur)),
          onDrop: () => drop(index ?? 0),
          onDragEnd: () => { dragFrom.current = null; setDragOver(null) },
          style: {
            cursor: 'grab',
            borderTop: dragOver === index && dragFrom.current !== null && dragFrom.current > (index ?? 0)
              ? '2px solid #1677ff' : undefined,
            borderBottom: dragOver === index && dragFrom.current !== null && dragFrom.current < (index ?? 0)
              ? '2px solid #1677ff' : undefined,
          },
        })}
        columns={[
          { title: '', width: 40, render: () => <HolderOutlined style={{ cursor: 'grab', color: '#999' }} /> },
          { title: '位置', width: 60, render: (_, __, i) => <span style={{ color: '#999' }}>{i + 1}</span> },
          {
            title: '槽位', render: (_, r) => (
              <Space>
                <span style={{ fontWeight: 600 }}>{slotOf(r.id)?.label ?? r.id}</span>
                <span style={{ fontSize: 12, color: '#bbb' }}>{r.id}</span>
                {slotOf(r.id)?.required && <Tag color="blue">不可隐藏</Tag>}
                {slotOf(r.id)?.feature && <Tag>受开关 {slotOf(r.id)?.feature} 控制</Tag>}
              </Space>
            ),
          },
          {
            title: '前台显示', width: 110, render: (_, r, i) => (
              <Switch checked={!r.hidden} checkedChildren="显示" unCheckedChildren="隐藏"
                disabled={slotOf(r.id)?.required}
                onChange={(v) => patch(i, { hidden: !v })} />
            ),
          },
          {
            title: '图标', width: 140, render: (_, r, i) => (
              <Select style={{ width: 120 }} value={r.icon} onChange={(v) => patch(i, { icon: v })}
                disabled={r.id === 'team'}
                options={(data?.icons ?? []).map((x) => ({ value: x, label: x }))} />
            ),
          },
          {
            title: '点击后去', width: 180, render: (_, r, i) => (
              <Select style={{ width: 160 }} value={r.targetPath} onChange={(v) => patch(i, { targetPath: v })}
                options={(data?.targets ?? []).map((x) => ({ value: x, label: TARGET_LABEL[x] ?? x }))} />
            ),
          },
        ]} />
    </div>
  )
}
