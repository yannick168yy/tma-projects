import { describe, expect, it } from 'vitest'
import { filterMarketRestrictedGames, type DbGame } from '../services/sg-game.service.js'

function game(provider: string): DbGame {
  return {
    uuid: `568win:${provider}`,
    name: provider,
    nameId: null,
    nameVi: null,
    nameZh: null,
    provider,
    category: '200',
    subCategory: null,
    sortCategory: 'slots',
    siteCategory: 'slot',
    imageUrl: null,
    imageHqUrl: null,
    hasLobby: false,
    isMobile: true,
    weight: 1,
    isFeatured: false,
  }
}

describe('印度市场游戏可见性', () => {
  const games = [game('Pragmatic Play'), game('PragmaticPlayCasino'), game('JILI')]

  it('INR 目录排除全部 Pragmatic Play 名称变体', () => {
    expect(filterMarketRestrictedGames(games, 'INR').map((item) => item.provider)).toEqual(['JILI'])
  })

  it('其他币种保持原目录不变', () => {
    expect(filterMarketRestrictedGames(games, 'PHP')).toEqual(games)
    expect(filterMarketRestrictedGames(games)).toEqual(games)
  })
})
