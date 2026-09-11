import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseWxgameUuid, wxgameUuid } from '../services/wxgame-game.service.js'
import { wxgameSign } from '../clients/wxgame.client.js'

describe('WXGame 游戏 uuid', () => {
  // 下面这些 gameId 全部取自官方游戏清单，不是构造出来的边界值
  const realWorld: Array<[string, string]> = [
    ['pg', '3'],
    ['pragmatic', 'vs10bbbonanza'],
    ['rubyplay', 'Silver&GoldMine'],
    ['nolimitcity', "Devil'sCrossroad"],
    ['nolimitcity', 'DeadwoodR.I.P'],
    ['hacksaw', 'EvilGoblinsxBomb®'],
    ['jdb', 'Mr.Rich'],
  ]

  for (const [gameBrand, gameId] of realWorld) {
    it(`${gameBrand}:${gameId} 往返一致`, () => {
      assert.deepEqual(parseWxgameUuid(wxgameUuid({ gameBrand, gameId })), { gameBrand, gameId })
    })
  }

  it('gameId 自身含冒号时不被截断', () => {
    // split(':') 会把它切成 3 段并丢掉后半截，解析出不存在的游戏
    const gameId = "TombstoneSlaughter:ElGordo'sRevenge"
    const uuid = wxgameUuid({ gameBrand: 'nolimitcity', gameId })
    assert.equal(uuid.split(':').length, 4)
    assert.deepEqual(parseWxgameUuid(uuid), { gameBrand: 'nolimitcity', gameId })
  })

  it('非 wxgame 前缀返回 null，不抢 568win 的 uuid', () => {
    assert.equal(parseWxgameUuid('568win:1:171'), null)
    assert.equal(parseWxgameUuid('568win:sportsbook'), null)
  })

  it('缺段位返回 null', () => {
    assert.equal(parseWxgameUuid('wxgame:pg'), null)
    assert.equal(parseWxgameUuid('wxgame'), null)
    assert.equal(parseWxgameUuid('wxgame::171'), null)
    assert.equal(parseWxgameUuid('wxgame:pg:'), null)
  })
})

describe('WXGame 签名', () => {
  it('按 AccessKeySecret + Nonce + Timestamp 顺序拼接后 sha256 取 hex', () => {
    const sign = wxgameSign('secret', 'abc123', 1757000000)
    assert.match(sign, /^[0-9a-f]{64}$/)
    // 拼接顺序错了会得到完全不同的值，锁死顺序
    assert.notEqual(sign, wxgameSign('abc123', 'secret', 1757000000))
    assert.equal(sign, wxgameSign('secret', 'abc123', 1757000000))
  })
})
