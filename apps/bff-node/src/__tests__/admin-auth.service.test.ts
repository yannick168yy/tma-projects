import { describe, expect, it } from 'vitest'
import { shouldRequireAdminTotp } from '../services/admin-auth.service.js'

describe('后台管理员 TOTP 强制策略', () => {
  it('开关开启时高权限角色必须绑定验证器', () => {
    expect(shouldRequireAdminTotp({ BFF_ADMIN_TOTP_REQUIRED: true }, 'super_admin')).toBe(true)
    expect(shouldRequireAdminTotp({ BFF_ADMIN_TOTP_REQUIRED: true }, 'finance')).toBe(true)
    expect(shouldRequireAdminTotp({ BFF_ADMIN_TOTP_REQUIRED: true }, 'ops')).toBe(false)
  })

  it('测试环境关闭开关时不强制任何角色绑定验证器', () => {
    expect(shouldRequireAdminTotp({ BFF_ADMIN_TOTP_REQUIRED: false }, 'super_admin')).toBe(false)
    expect(shouldRequireAdminTotp({ BFF_ADMIN_TOTP_REQUIRED: false }, 'finance')).toBe(false)
  })
})
