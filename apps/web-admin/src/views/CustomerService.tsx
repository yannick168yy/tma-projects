import { useEffect, useRef, useState } from 'react'
import { Card, Select, Tag, Button, Input, Space, Empty, Badge, Switch, Tooltip, message, Grid } from 'antd'
import type { CsConversation, CsMessage } from '../api'
import { getCsConversations, getCsConversation, csReply, csTakeover, csClose, getCsDuty, saveCsDuty } from '../api'

function statusColor(status?: string) {
  return ({ active: 'blue', escalated: 'red', human_taken: 'orange', resolved: 'green', closed: 'default' } as Record<string, string>)[status ?? ''] ?? 'default'
}
function statusText(status?: string) {
  return ({ active: 'AI处理', escalated: '离线工单', human_taken: '待人工', resolved: '已解决', closed: '已关闭' } as Record<string, string>)[status ?? ''] ?? status
}
function reasonText(reason?: string | null) {
  if (!reason) return ''
  return ({
    user_request: '用户要求人工', money_dispute: '资金争议', account_security: '账号安全',
    complaint: '投诉/退款', unresolved: 'AI 未解决', other: '其他',
  } as Record<string, string>)[reason] ?? reason
}
function formatTime(t?: string) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function CustomerService() {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [conversations, setConversations] = useState<CsConversation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('escalated')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [messages, setMessages] = useState<CsMessage[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)
  const msgListRef = useRef<HTMLDivElement>(null)

  const [duty, setDuty] = useState<{ enabled: boolean; onlineAdmins: number; onDuty: boolean } | null>(null)
  const [dutySaving, setDutySaving] = useState(false)

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null
  const unreadCount = conversations.filter((c) => c.status === 'human_taken' || c.status === 'escalated').length

  useEffect(() => {
    getCsDuty().then((res) => {
      setDuty(res)
      setStatusFilter(res.onDuty ? 'human_taken' : 'escalated')
    }).catch(() => {})
  }, [])

  async function toggleDuty(enabled: boolean) {
    setDutySaving(true)
    try {
      await saveCsDuty(enabled)
      setDuty((prev) => prev ? { ...prev, enabled, onDuty: enabled && prev.onlineAdmins > 0 } : prev)
      setStatusFilter(enabled ? 'human_taken' : 'escalated')
      message.success(enabled ? '已开启客服值班' : '已关闭值班,新转人工将进入离线工单')
    } catch { message.error('操作失败') }
    finally { setDutySaving(false) }
  }

  async function loadList(p = 1) {
    setLoading(true)
    try {
      const res = await getCsConversations({ status: statusFilter || undefined, page: p, pageSize: 30 })
      if (p === 1) setConversations(res.items)
      else setConversations((prev) => [...prev, ...res.items])
      setTotal(res.total)
      setPage(p)
    } finally { setLoading(false) }
  }

  async function refreshDetail() {
    if (!selectedId) return
    setDetailLoading(true)
    try {
      const res = await getCsConversation(selectedId)
      setMessages(res.messages)
      setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, ...res.conversation } : c))
      setTimeout(() => { if (msgListRef.current) msgListRef.current.scrollTop = msgListRef.current.scrollHeight }, 50)
    } finally { setDetailLoading(false) }
  }

  useEffect(() => {
    void loadList(1)
    const timer = setInterval(() => {
      void loadList(1)
      if (selectedId) void refreshDetail()
    }, 15_000)
    return () => clearInterval(timer)
  }, [statusFilter])

  useEffect(() => { if (selectedId) void refreshDetail() }, [selectedId])

  async function sendReply() {
    if (!replyText.trim() || !selectedId) return
    setReplying(true)
    try {
      const msg = await csReply(selectedId, replyText.trim())
      setMessages((prev) => [...prev, msg])
      setReplyText('')
      setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, lastMessage: msg.content } : c))
      setTimeout(() => { if (msgListRef.current) msgListRef.current.scrollTop = msgListRef.current.scrollHeight }, 50)
    } catch (e) { message.error(e instanceof Error ? e.message : '发送失败') }
    finally { setReplying(false) }
  }

  async function takeover() {
    if (!selectedId) return
    await csTakeover(selectedId)
    message.success('已接管会话')
    await refreshDetail(); await loadList(1)
  }

  async function resolve() {
    if (!selectedId) return
    await csClose(selectedId)
    message.success('会话已结束')
    setSelectedId(null); setMessages([])
    await loadList(1)
  }

  // 手机上主从切换:未选会话显示列表,选中显示聊天
  const showList = !isMobile || !selectedId
  const showChat = !isMobile || !!selectedId

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 112px)' }}>
      {showList && (
      <Card
        style={{ width: isMobile ? '100%' : 340, flexShrink: 0, overflow: 'auto' }}
        styles={{ body: { padding: '8px 0' } }}
        title={<span>客服会话 <Badge count={unreadCount} style={{ marginLeft: 8 }} /></span>}
        extra={
          <Space size={8}>
            <Tooltip title="关闭后用户转人工将进入离线工单模式(AI 如实告知无人在线并留单)">
              <Switch
                size="small"
                checked={duty?.enabled ?? true}
                loading={dutySaving}
                checkedChildren="值班"
                unCheckedChildren="离线"
                onChange={(v) => void toggleDuty(v)}
              />
            </Tooltip>
            <Select
              value={statusFilter}
              size="small"
              style={{ width: 110 }}
              onChange={(v) => { setStatusFilter(v); void loadList(1) }}
              options={[
                { value: 'pending', label: '待处理' }, { value: '', label: '全部' }, { value: 'active', label: 'AI 处理中' },
                { value: 'escalated', label: '离线工单' },
                { value: 'human_taken', label: '待人工' }, { value: 'resolved', label: '已解决' },
                { value: 'closed', label: '已关闭' },
              ]}
            />
          </Space>
        }
      >
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => setSelectedId(conv.id)}
            style={{
              padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
              transition: 'background 0.15s',
              background: selectedId === conv.id ? '#e6f4ff' : undefined,
            }}
            onMouseEnter={(e) => { if (selectedId !== conv.id) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5' }}
            onMouseLeave={(e) => { if (selectedId !== conv.id) (e.currentTarget as HTMLDivElement).style.background = '' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>工单 #{conv.id} · {conv.displayName || `用户#${conv.userId}`}</span>
              <Tag color={statusColor(conv.status)} style={{ margin: 0, fontSize: 11 }}>{statusText(conv.status)}</Tag>
            </div>
            <div style={{ color: '#999', fontSize: 12, marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {conv.lastMessage || '（暂无消息）'}
            </div>
            <div style={{ color: '#bbb', fontSize: 11, marginTop: 2 }}>{formatTime(conv.updatedAt)}</div>
          </div>
        ))}
        {!loading && conversations.length === 0 && <Empty description="暂无会话" style={{ padding: '32px 0' }} />}
        {conversations.length < total && (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <Button type="link" size="small" loading={loading} onClick={() => loadList(page + 1)}>加载更多</Button>
          </div>
        )}
      </Card>
      )}

      {showChat && (selectedId ? (
        <Card
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 12, overflow: 'hidden' } }}
          title={
            <span>
              {isMobile && <Button size="small" style={{ marginRight: 8 }} onClick={() => setSelectedId(null)}>返回</Button>}
              工单 #{selectedConv?.id} · {selectedConv?.displayName || `用户#${selectedConv?.userId}`}
              <Tag color={statusColor(selectedConv?.status)} style={{ marginLeft: 8 }}>{statusText(selectedConv?.status)}</Tag>
              {selectedConv?.escalateReason && <Tag color="volcano">{reasonText(selectedConv.escalateReason)}</Tag>}
            </span>
          }
          extra={
            <Space>
              {(selectedConv?.status === 'active' || selectedConv?.status === 'escalated') && <Button size="small" onClick={takeover}>接管会话</Button>}
              {selectedConv?.status !== 'resolved' && selectedConv?.status !== 'closed' && (
                <Button size="small" type="primary" ghost onClick={resolve}>结束会话</Button>
              )}
              <Button size="small" onClick={refreshDetail} loading={detailLoading}>刷新</Button>
            </Space>
          }
        >
          <div ref={msgListRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', marginBottom: 12, justifyContent: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  maxWidth: '70%', padding: '8px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                  background: msg.role === 'user' ? '#f0f0f0' : msg.role === 'assistant' ? '#e6f4ff' : '#f6ffed',
                }}>
                  <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>
                    {msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '🤖 AI' : '👤 客服'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 4, textAlign: 'right' }}>{formatTime(msg.createdAt)}</div>
                </div>
              </div>
            ))}
            {messages.length === 0 && <Empty description="暂无消息" />}
          </div>
          {selectedConv?.status !== 'resolved' && selectedConv?.status !== 'closed' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <Input.TextArea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder="输入回复内容，Ctrl+Enter 发送"
                style={{ flex: 1 }}
                onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') void sendReply() }}
              />
              <Button type="primary" loading={replying} onClick={sendReply} style={{ height: 'auto' }}>发送</Button>
            </div>
          )}
        </Card>
      ) : (
        !isMobile && <Empty description="选择一个会话开始处理" style={{ margin: 'auto' }} />
      ))}
    </div>
  )
}
