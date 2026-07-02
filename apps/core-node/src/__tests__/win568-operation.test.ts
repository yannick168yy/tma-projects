import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectWin568ReportBets, toWin568Username } from '../routes/win568-operation.routes.js'

describe('568Win Operation', () => {
  it('从本地 userId 生成 568Win 合法用户名', () => {
    assert.equal(toWin568Username('BG-10024'), 'BG_10024')
  })

  it('从报表响应中提取注单记录', () => {
    const bets = collectWin568ReportBets({
      SportsBook: {
        betList: [
          { refNo: '1001', username: 'BG_10025' },
          { refno: '1002', username: 'BG_10025' },
        ],
      },
    })
    assert.deepEqual(bets.map((bet) => bet.refNo ?? bet.refno), ['1001', '1002'])
  })
})
