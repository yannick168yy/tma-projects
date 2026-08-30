import { describe, expect, it } from 'vitest'
import { marketForHost, normalizeSiteDomainMappings } from '../services/site-domain.service.js'

describe('站点域名映射', () => {
  it('统一裸域并忽略重复和非法市场', () => {
    expect(normalizeSiteDomainMappings([
      { domain: 'https://WWW.BETOGO.XYZ/path', market: 'id', enabled: true },
      { domain: 'betogo.xyz', market: 'PH', enabled: true },
      { domain: 'betogo666.com', market: 'ph', enabled: false },
      { domain: 'invalid.example', market: 'SG', enabled: true },
    ])).toEqual([
      { domain: 'betogo.xyz', market: 'ID', enabled: true },
      { domain: 'betogo666.com', market: 'PH', enabled: false },
    ])
  })

  it('www 与裸域命中同一配置，禁用项不生效', () => {
    const mappings = normalizeSiteDomainMappings([
      { domain: 'betogo.games', market: 'ID', enabled: true },
      { domain: 'betogo666.com', market: 'PH', enabled: false },
    ])
    expect(marketForHost(mappings, 'www.betogo.games')).toBe('ID')
    expect(marketForHost(mappings, 'https://betogo.games/auth/google/callback')).toBe('ID')
    expect(marketForHost(mappings, 'betogo666.com')).toBeNull()
  })
})
