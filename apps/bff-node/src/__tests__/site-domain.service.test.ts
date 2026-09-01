import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import {
  appDomainsForMarket, defaultAppDomainsForMarket, marketForHost,
  normalizeSiteDomainMappings, saveSiteDomainMappings,
} from '../services/site-domain.service.js'

const redisStub = { get: async () => null, set: async () => 'OK' } as unknown as Redis
const envStub = {} as Env

describe('站点域名映射', () => {
  it('统一裸域并忽略重复和非法市场', () => {
    expect(normalizeSiteDomainMappings([
      { domain: 'https://WWW.BETOGO.XYZ/path', market: 'id', enabled: true },
      { domain: 'betogo.xyz', market: 'PH', enabled: true },
      { domain: 'betogo666.com', market: 'ph', enabled: false },
      { domain: 'betogo.app', market: 'public', enabled: true },
      { domain: 'invalid.example', market: 'SG', enabled: true },
    ])).toEqual([
      { domain: 'betogo.xyz', market: 'ID', enabled: true, appMarket: null, appPriority: 100 },
      { domain: 'betogo666.com', market: 'PH', enabled: false, appMarket: null, appPriority: 100 },
      { domain: 'betogo.app', market: 'PUBLIC', enabled: true, appMarket: null, appPriority: 100 },
    ])
  })

  it('www 与裸域命中同一配置，禁用项不生效', () => {
    const mappings = normalizeSiteDomainMappings([
      { domain: 'betogo.games', market: 'PUBLIC', enabled: true },
      { domain: 'betogo666.com', market: 'PH', enabled: false },
    ])
    expect(marketForHost(mappings, 'www.betogo.games')).toBeNull()
    expect(marketForHost(mappings, 'https://betogo.games/auth/google/callback')).toBeNull()
    expect(marketForHost(mappings, 'betogo666.com')).toBeNull()
  })

  it('按市场和优先级返回启用且市场一致的 App 域名', () => {
    const mappings = normalizeSiteDomainMappings([
      { domain: 'betogo.vip', market: 'ID', enabled: true, appMarket: 'ID', appPriority: 30 },
      { domain: 'betogo.app', market: 'ID', enabled: true, appMarket: 'ID', appPriority: 10 },
      { domain: 'betogo.xyz', market: 'PH', enabled: true, appMarket: 'ID', appPriority: 20 },
      { domain: 'betogo.cc', market: 'ID', enabled: false, appMarket: 'ID', appPriority: 5 },
    ])
    expect(appDomainsForMarket(mappings, 'ID').map((item) => item.domain)).toEqual(['betogo.app', 'betogo.vip'])
  })

  it('保存时拒绝 App 域名组与所属站点不一致', async () => {
    await expect(saveSiteDomainMappings(redisStub, envStub, [
      { domain: 'betogo.games', market: 'PH', enabled: true, appMarket: 'ID', appPriority: 10 },
    ])).rejects.toThrow('与所属站点不一致')
  })

  it('保存时拒绝把某个市场的线路清空', async () => {
    await expect(saveSiteDomainMappings(redisStub, envStub, [
      { domain: 'betogo.games', market: 'PH', enabled: false, appMarket: 'PH', appPriority: 10 },
      { domain: 'betogo.app', market: 'ID', enabled: true, appMarket: 'ID', appPriority: 10 },
    ])).rejects.toThrow('菲律宾 App 至少要保留一个启用的线路域名')
  })

  it('兜底线路表按优先级给出非空域名', () => {
    expect(defaultAppDomainsForMarket('PH').map((item) => item.domain))
      .toEqual(['betogo.games', 'betogo666.com', 'betogo777.com'])
    expect(defaultAppDomainsForMarket('ID').every((item) => item.enabled && item.appMarket === 'ID')).toBe(true)
  })
})
