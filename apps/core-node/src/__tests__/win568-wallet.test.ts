import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyInstance, FastifyRequest } from 'fastify'

process.env.NODE_ENV = 'test'
process.env.WIN568_SW_COMPANY_KEY = 'test-key'
process.env.WIN568_SW_ALLOWED_IPS = '122.146.58.49'

describe('568Win 钱包回调', () => {
  it('GetBetStatus 对 rollback 后的 running 注单仍返回 running', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    const conn = {
      async query(sql: string) {
        if (sql.includes('bg_568win_wallet_txn')) {
          return [[{
            id: 1,
            user_id: 'BG-10024',
            external_username: 'BG-10024',
            currency: 'PHP',
            transfer_code: '244135',
            transaction_id: '244135',
            product_type: 1,
            game_type: 1,
            gpid: -1,
            provider_id: '',
            round_id: null,
            txn_type: 'bet',
            amount: '10.0000',
            win_loss: '30.0000',
            status: 'running',
          }], undefined]
        }
        return [[], undefined]
      },
      release() {},
    }
    const mysql = {
      async query(sql: string) {
        if (sql.includes('bg_aggregator_player')) {
          return [[{
            user_id: 'BG-10024',
            external_username: 'BG-10024',
            currency: 'PHP',
            status: 'active',
          }], undefined]
        }
        return [[], undefined]
      },
      async getConnection() {
        return conn
      },
    }
    const app = {
      mysql,
      log: { error() {} },
    } as unknown as FastifyInstance
    const req = {
      headers: { 'x-real-ip': '122.146.58.49' },
      ip: '127.0.0.1',
    } as unknown as FastifyRequest

    const result = await new Win568WalletService(app).getBetStatus(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      TransferCode: '244135',
      TransactionId: '244135',
      ProductType: 1,
      GameType: 1,
      Gpid: -1,
    })

    assert.equal(result.ErrorCode, 0)
    assert.equal(result.Status, 'running')
    assert.equal(result.WinLoss, 0)
    assert.equal(result.Stake, 10)
  })
})
