import { describe, expect, it } from 'vitest'
import { API_SCOPES, isApiScope } from '../services/open-api.service.js'

describe('开放 API 权限范围（P3-7）', () => {
  it('只认白名单里的 scope：随手传个 users:write 不该被接受', () => {
    expect(isApiScope('users:read')).toBe(true)
    expect(isApiScope('users:write')).toBe(false)
    expect(isApiScope('*')).toBe(false)
    expect(isApiScope(undefined)).toBe(false)
  })

  it('v1 全部是只读 scope：写接口不通过 key 开放', () => {
    expect(API_SCOPES.every((s) => s.endsWith(':read'))).toBe(true)
  })
})
