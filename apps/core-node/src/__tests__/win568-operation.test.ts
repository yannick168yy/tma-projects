import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildWin568LaunchPayload,
  buildWin568SportsbookPayload,
  collectWin568ReportBets,
  toWin568Username,
} from '../routes/win568-operation.routes.js'

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

  it('568Win Sports 使用 568WinSportsbook 登录入口', () => {
    assert.deepEqual(buildWin568SportsbookPayload({
      username: 'BG_10025',
      device: 'mobile',
      language: 'en',
    }), {
      Username: 'BG_10025',
      Portfolio: '568WinSportsbook',
      Lang: 'EN',
      Device: 'm',
      OddStyle: 'MY',
      OddsMode: 'double',
    })
  })

  it('三方体育游戏使用 ThirdPartySportsBook 登录入口', () => {
    assert.deepEqual(buildWin568LaunchPayload({
      username: 'BG_10025',
      gameId: 1,
      gpId: 2697,
      newGameType: 300,
      device: 'mobile',
      language: 'en',
    }), {
      Username: 'BG_10025',
      Portfolio: 'ThirdPartySportsBook',
      Lang: 'en',
      Device: 'm',
      GpId: 2697,
      GameId: 1,
    })
  })

  it('非体育游戏保持 SeamlessGame 登录入口', () => {
    assert.deepEqual(buildWin568LaunchPayload({
      username: 'BG_10025',
      gameId: 2001,
      gpId: 324,
      newGameType: 200,
      device: 'desktop',
      language: 'en',
    }), {
      Username: 'BG_10025',
      Portfolio: 'SeamlessGame',
      Lang: 'en',
      Device: 'd',
      GpId: 324,
      GameId: 2001,
    })
  })
})
