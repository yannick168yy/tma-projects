import type { FastifyInstance } from 'fastify'
import { WxgameWalletService } from '../services/wxgame-wallet.service.js'

export async function wxgameWalletRoutes(app: FastifyInstance) {
  const svc = new WxgameWalletService(app)

  app.post('/verify', async (req) => svc.verify(req, req.body as Record<string, unknown>))
  app.post('/balance', async (req) => svc.balance(req, req.body as Record<string, unknown>))
}
