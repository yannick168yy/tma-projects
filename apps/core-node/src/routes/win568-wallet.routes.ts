import type { FastifyInstance, FastifyReply } from 'fastify'
import { Win568WalletService } from '../services/win568-wallet.service.js'

const moneyKeys = new Set(['Balance', 'BetAmount', 'WinLoss', 'Stake'])

function stringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stringify(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const body = typeof item === 'number' && moneyKeys.has(key)
        ? item.toFixed(2)
        : stringify(item)
      return `${JSON.stringify(key)}:${body}`
    })
    return `{${entries.join(',')}}`
  }
  return 'null'
}

function sendWin568(reply: FastifyReply, payload: unknown) {
  return reply.type('application/json; charset=utf-8').send(stringify(payload))
}

export async function win568WalletRoutes(app: FastifyInstance) {
  const svc = new Win568WalletService(app)

  app.post('/GetBalance', async (req, reply) => sendWin568(reply, await svc.getBalance(req, req.body as Record<string, unknown>)))
  app.post('/Deduct', async (req, reply) => sendWin568(reply, await svc.deduct(req, req.body as Record<string, unknown>)))
  app.post('/ReturnStake', async (req, reply) => sendWin568(reply, await svc.returnStake(req, req.body as Record<string, unknown>)))
  app.post('/Settle', async (req, reply) => sendWin568(reply, await svc.settle(req, req.body as Record<string, unknown>)))
  app.post('/Rollback', async (req, reply) => sendWin568(reply, await svc.rollback(req, req.body as Record<string, unknown>)))
  app.post('/Cancel', async (req, reply) => sendWin568(reply, await svc.cancel(req, req.body as Record<string, unknown>)))
  app.post('/Bonus', async (req, reply) => sendWin568(reply, await svc.bonus(req, req.body as Record<string, unknown>)))
  app.post('/GetBetStatus', async (req, reply) => sendWin568(reply, await svc.getBetStatus(req, req.body as Record<string, unknown>)))
}
