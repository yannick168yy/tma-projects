import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyInstance, FastifyRequest } from 'fastify'

process.env.NODE_ENV = 'test'
process.env.WIN568_SW_COMPANY_KEY = 'test-key'
process.env.WIN568_SW_ALLOWED_IPS = '122.146.58.49'

describe('568Win 钱包回调', () => {
  async function returnStakeWithBet(status: string, stake = '6.0000') {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    const conn = {
      async query(sql: string) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 1044 }], undefined]
        if (sql.includes('bg_568win_wallet_txn')) {
          return [[{
            id: 1,
            user_id: 'BG-10024',
            external_username: 'BG-10024',
            currency: 'PHP',
            transfer_code: 'BTiSports_20_1001_1782963449193',
            transaction_id: '1782963449193',
            product_type: 9,
            game_type: 0,
            gpid: 1022,
            provider_id: '',
            round_id: 'H4TBC9CO7M',
            txn_type: 'bet',
            amount: stake,
            win_loss: status === 'settled' ? '30.0000' : null,
            status,
          }], undefined]
        }
        return [[], undefined]
      },
      async execute() {
        return [{ insertId: 1 }, undefined]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
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

    return new Win568WalletService(app).returnStake(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      ProductType: 9,
      GameType: 0,
      Gpid: 1022,
      CurrentStake: 6,
      TransferCode: 'BTiSports_20_1001_1782963449193',
      TransactionId: '1782963449193',
    })
  }

  it('Deduct 拒绝没有 promotionReward 的 Sports 0 金额 FreeBet', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    const executes: string[] = []
    const conn = {
      async query(sql: string) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 650 }], undefined]
        return [[], undefined]
      },
      async execute(sql: string) {
        executes.push(sql)
        return [{ insertId: 1 }, undefined]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
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

    const result = await new Win568WalletService(app).deduct(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      Amount: 0,
      TransferCode: '13792516SFBN',
      TransactionId: '13792516SFBN',
      ProductType: 1,
      GameType: 1,
      Gpid: -2,
      ExtraInfo: {
        sportType: 'Football',
        marketType: 'Over/Under',
      },
    }) as Record<string, unknown>

    assert.equal(result.ErrorCode, 7)
    assert.equal(result.BetAmount, 0)
    assert.equal(executes.some((sql) => sql.includes('INSERT INTO bg_568win_wallet_txn')), false)
  })

  it('Deduct 接受带 promotionRewardAmount 的 Sports 0 金额 FreeBet', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    const executes: string[] = []
    const conn = {
      async query(sql: string) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 690 }], undefined]
        if (sql.includes('bg_568win_wallet_txn')) return [[], undefined]
        return [[], undefined]
      },
      async execute(sql: string) {
        executes.push(sql)
        return [{ insertId: 1 }, undefined]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
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

    const result = await new Win568WalletService(app).deduct(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      Amount: 0,
      TransferCode: '59239416SFBS',
      TransactionId: '59239416SFBS',
      ProductType: 1,
      GameType: 1,
      Gpid: -2,
      ExtraInfo: {
        sportType: 'Football',
        promotionRewardCode: 'FB-59239416SFBS',
        promotionRewardAmount: 50,
        promotionEventId: 1001,
      },
    }) as Record<string, unknown>

    assert.equal(result.ErrorCode, 0)
    assert.equal(result.Balance, 690)
    assert.equal(result.BetAmount, 0)
    assert.equal(executes.some((sql) => sql.includes('INSERT INTO bg_568win_wallet_txn')), true)
  })

  it('Deduct 拒绝没有 promotionReward 的第三方体育 0 金额 FreeBet', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    const executes: string[] = []
    const conn = {
      async query(sql: string) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 890 }], undefined]
        return [[], undefined]
      },
      async execute(sql: string) {
        executes.push(sql)
        return [{ insertId: 1 }, undefined]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
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

    const result = await new Win568WalletService(app).deduct(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      Amount: 0,
      TransferCode: 'Saba Sports4414913324SFBN',
      TransactionId: 'Saba Sports4414913324SFBN',
      ProductType: 9,
      GameType: 0,
      Gpid: 44,
      NewGameType: 300,
      SeamlessGameExtraInfo: {
        FeatureBuyStatus: 0,
        EndRoundStatus: 0,
      },
    }) as Record<string, unknown>

    assert.equal(result.ErrorCode, 7)
    assert.equal(result.BetAmount, 0)
    assert.equal(executes.some((sql) => sql.includes('INSERT INTO bg_568win_wallet_txn')), false)
  })

  it('ReturnStake 退回原 stake 与 CurrentStake 的差额', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    let balance = 990
    const executes: Array<{ sql: string; params?: unknown[] }> = []
    const conn = {
      async query(sql: string) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: balance }], undefined]
        if (sql.includes('bg_568win_wallet_txn')) {
          return [[{
            id: 1,
            user_id: 'BG-10024',
            external_username: 'BG-10024',
            currency: 'PHP',
            transfer_code: 'BTiSports_20_1001_1782962691164',
            transaction_id: '1782962691164',
            product_type: 9,
            game_type: 0,
            gpid: 1022,
            provider_id: '',
            round_id: 'H4TBC9CO7M',
            txn_type: 'bet',
            amount: '10.0000',
            win_loss: null,
            status: 'running',
          }], undefined]
        }
        return [[], undefined]
      },
      async execute(sql: string, params?: unknown[]) {
        executes.push({ sql, params })
        if (sql.includes('UPDATE bg_wallet SET available')) balance += Number(params?.[0] ?? 0)
        return [{ insertId: 1 }, undefined]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
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

    const result = await new Win568WalletService(app).returnStake(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      ProductType: 9,
      GameType: 0,
      Gpid: 1022,
      CurrentStake: 6,
      TransferCode: 'BTiSports_20_1001_1782962691164',
      TransactionId: '1782962691164',
    })

    assert.equal(result.ErrorCode, 0)
    assert.equal(result.Balance, 994)
    assert.equal(executes.some((e) => e.sql.includes('UPDATE bg_568win_wallet_txn SET amount = ?') && e.params?.[0] === 6), true)
    assert.equal(executes.some((e) => e.sql.includes('INSERT INTO bg_wallet_ledger') && e.params?.[4] === 4), true)
  })

  it('ReturnStake 重复请求返回 5003', async () => {
    const result = await returnStakeWithBet('running')

    assert.equal(result.ErrorCode, 5003)
  })

  it('ReturnStake 遇到 settled 注单返回 2001', async () => {
    const result = await returnStakeWithBet('settled', '10.0000')

    assert.equal(result.ErrorCode, 2001)
  })

  it('ReturnStake 遇到 Void 注单返回 2002', async () => {
    const result = await returnStakeWithBet('Void', '10.0000')

    assert.equal(result.ErrorCode, 2002)
  })

  it('Rollback 并发冲突但发现已 rollback 时返回 2003', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    let afterConflict = false
    let fallbackReads = 0
    const conn = {
      async query(sql: string) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 1104 }], undefined]
        if (sql.includes('bg_568win_wallet_txn')) {
          const rollbackVisible = afterConflict && !sql.includes('FOR UPDATE') && fallbackReads++ > 0
          return [[{
            id: 1,
            user_id: 'BG-10024',
            external_username: 'BG-10024',
            currency: 'PHP',
            transfer_code: 'BTiSports102236570523',
            transaction_id: null,
            product_type: 9,
            game_type: 100,
            gpid: 1022,
            provider_id: '',
            round_id: 'BTiSports102236570523',
            txn_type: 'bet',
            amount: '10.0000',
            win_loss: '30.0000',
            status: rollbackVisible ? 'running' : 'settled',
          }], undefined]
        }
        return [[], undefined]
      },
      async execute(sql: string) {
        if (sql.includes('UPDATE bg_568win_wallet_txn SET status =')) {
          afterConflict = true
          throw new Error('deadlock')
        }
        return [{ insertId: 1 }, undefined]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
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

    const result = await new Win568WalletService(app).rollback(req, {
      CompanyKey: 'test-key',
      Username: 'BG-10024',
      TransferCode: 'BTiSports102236570523',
      ProductType: 9,
      GameType: 100,
      Gpid: 1022,
    })

    assert.equal(result.ErrorCode, 2003)
    assert.equal(result.AccountName, 'BG-10024')
    assert.equal(result.Balance, 1104)
  })

  it('CompanyKey 比对忽略测试页传入的空白字符', async () => {
    const { Win568WalletService } = await import('../services/win568-wallet.service.js')
    const conn = {
      async query() {
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
      CompanyKey: 'te st-key',
      Username: 'BG-10024',
      TransferCode: '306732',
      TransactionId: '306732',
      ProductType: 1,
      GameType: 1,
      Gpid: -1,
    })

    assert.equal(result.ErrorCode, 6)
  })

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
