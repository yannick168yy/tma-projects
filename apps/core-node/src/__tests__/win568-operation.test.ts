import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toWin568Username } from '../routes/win568-operation.routes.js'

describe('568Win Operation', () => {
  it('从本地 userId 生成 568Win 合法用户名', () => {
    assert.equal(toWin568Username('BG-10024'), 'BG_10024')
  })
})
