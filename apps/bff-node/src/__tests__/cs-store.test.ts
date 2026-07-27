import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeCurrentConversation, expireStaleConversations, listConversations, saveConversationSummary } from '../services/cs/cs-store.js'

const query = vi.fn()

vi.mock('../clients/mysql.client.js', () => ({
  getMysqlPool: vi.fn(() => ({ query })),
}))

vi.mock('../services/sse-badges.js', () => ({
  broadcastBadges: vi.fn(),
}))

vi.mock('../services/admin-notify.js', () => ({
  notifyCsHuman: vi.fn(),
}))

describe('客服会话存储', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('闲置过期不自动关闭离线工单', async () => {
    query.mockResolvedValue([{ affectedRows: 0 }])

    await expireStaleConversations({} as never)

    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain("c.status IN ('active','human_taken')")
    expect(sql).not.toContain("'escalated'")
  })

  it('pending 筛选同时包含待人工和离线工单', async () => {
    query
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[{
        id: 4,
        user_id: 'BG-10001',
        status: 'escalated',
        assigned_admin_id: null,
        agent_name: null,
        escalate_reason: 'user_request',
        user_left_at: null,
        created_at: new Date('2026-07-24T00:00:00Z'),
        updated_at: new Date('2026-07-24T00:01:00Z'),
        resolved_at: null,
        display_name: 'Test User',
        last_message: 'help',
      }]])
      .mockResolvedValueOnce([[{ total: 1 }]])

    const result = await listConversations({} as never, { status: 'pending', limit: 30, offset: 0 })

    expect(result.items[0].id).toBe(4)
    expect(String(query.mock.calls[1][0])).toContain("WHERE c.status IN ('human_taken','escalated')")
    expect(query.mock.calls[1][1]).toEqual([30, 0])
    expect(query.mock.calls[2][1]).toEqual([])
  })

  it('用户结束会话不关闭离线工单', async () => {
    const escalatedRow = {
      id: 4,
      user_id: 'BG-10001',
      status: 'escalated',
      assigned_admin_id: null,
      agent_name: null,
      escalate_reason: 'user_request',
      user_left_at: null,
      created_at: new Date('2026-07-24T00:00:00Z'),
      updated_at: new Date('2026-07-24T00:01:00Z'),
      resolved_at: null,
    }
    query
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[escalatedRow]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[escalatedRow]])

    const result = await closeCurrentConversation({} as never, 'BG-10001')

    expect(result?.status).toBe('escalated')
    expect(String(query.mock.calls[2][0])).toContain('SET user_left_at = NOW()')
    expect(query.mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain("SET status = 'closed'")
  })

  it('保存 AI 总结到会话', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 1 }])

    await saveConversationSummary({} as never, 4, {
      summary: '用户询问提现失败，AI 已提示查看订单状态，建议人工核对出款记录。',
      model: 'gemini-2.5-flash-lite',
      messageCount: 6,
    })

    expect(String(query.mock.calls[0][0])).toContain('ai_summary = ?')
    expect(query.mock.calls[0][1]).toEqual([
      '用户询问提现失败，AI 已提示查看订单状态，建议人工核对出款记录。',
      'gemini-2.5-flash-lite',
      6,
      4,
    ])
  })
})
