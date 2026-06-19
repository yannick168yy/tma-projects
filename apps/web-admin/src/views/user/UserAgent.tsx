import { useEffect, useState } from 'react'
import { Card, Button, InputNumber, Input, Space, Tag, message, Popconfirm } from 'antd'
import {
  getUserAgentInfo, createAgent, updateAgent, bindUserToAgent, unbindUserAgent,
} from '../../api'

const SOURCE_LABEL: Record<string, string> = { domain: '域名', bot: '机器人', manual: '手动' }

export default function UserAgent({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getUserAgentInfo>> | null>(null)
  const [rate, setRate] = useState<number>(0)
  const [name, setName] = useState('')
  const [bindAgentId, setBindAgentId] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await getUserAgentInfo(userId)
      setInfo(data)
      if (data.agent) {
        setRate(Number(data.agent.ggr_rate_pct))
        setName(data.agent.name)
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [userId])

  async function handleSaveAgent() {
    try {
      if (info?.isAgent) {
        await updateAgent(userId, { name, ggrRatePct: rate })
        message.success('已更新代理设置')
      } else {
        await createAgent({ userId, name, ggrRatePct: rate })
        message.success('已设为代理')
      }
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function handleDisable() {
    try { await updateAgent(userId, { status: 'disabled' }); message.success('已停用代理'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function handleBind() {
    if (!bindAgentId.trim()) { message.warning('请输入代理用户ID'); return }
    try { await bindUserToAgent(userId, bindAgentId.trim()); message.success('已指定归属代理'); setBindAgentId(''); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function handleUnbind() {
    try { await unbindUserAgent(userId); message.success('已解除归属'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  return (
    <Card title="代理身份与归属" loading={loading} size="small">
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          代理身份{' '}
          {info?.isAgent
            ? <Tag color={info.agent?.status === 'active' ? 'green' : 'default'}>{info.agent?.status === 'active' ? '代理（启用）' : '代理（停用）'}</Tag>
            : <Tag>非代理</Tag>}
        </div>
        <Space wrap>
          <span>名称</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="代理名称" style={{ width: 160 }} />
          <span>GGR分成%</span>
          <InputNumber value={rate} onChange={(v) => setRate(Number(v ?? 0))} min={0} max={100} step={0.5} />
          <Button type="primary" onClick={handleSaveAgent}>{info?.isAgent ? '保存' : '设为代理'}</Button>
          {info?.isAgent && info.agent?.status === 'active' && (
            <Popconfirm title="确认停用该代理？" onConfirm={handleDisable}>
              <Button danger>停用</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>归属代理（该用户业绩归谁）</div>
        {info?.attributedTo ? (
          <Space wrap>
            <Tag color="blue">{info.attributedTo.agent_name || info.attributedTo.agent_id}（{info.attributedTo.agent_id}）</Tag>
            <span>来源：{SOURCE_LABEL[info.attributedTo.source] ?? info.attributedTo.source}</span>
            <Popconfirm title="确认解除该用户的代理归属？" onConfirm={handleUnbind}>
              <Button size="small" danger>解除</Button>
            </Popconfirm>
          </Space>
        ) : (
          <Space wrap>
            <span style={{ color: '#999' }}>未归属任何代理</span>
            <Input value={bindAgentId} onChange={(e) => setBindAgentId(e.target.value)} placeholder="代理用户ID，如 BG-10001" style={{ width: 200 }} />
            <Button onClick={handleBind}>指定归属</Button>
          </Space>
        )}
      </div>
    </Card>
  )
}
