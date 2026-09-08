import { http, type ApiResp } from '../../api'

export type Aggregator = '568win' | 'wxgame'
export interface Provider { id: number; code: string; name: string; aliases: Record<Aggregator, string[]> }
export interface Game { id: number; providerId: number; uuid: string; name: string; enabled: boolean; isActive: boolean; presentation: { imageUrl?: string; sortCategory?: string; siteCategory?: string; weight?: number; isFeatured?: boolean } }
export interface Source { gameId: number; aggregator: Aggregator; uuid: string; currencies: string[] }
export interface Rule { scope: 'global' | 'provider' | 'game'; targetId: number; aggregator: Aggregator }
export interface Config { providers: Provider[]; games: Game[]; sources: Source[]; rules: Rule[]; revision: string }
export interface SourceGame { uuid: string; aggregator: Aggregator; provider: string; name: string; imageUrl: string | null; available: boolean; currencies: string[] | null; mobile: boolean; desktop: boolean; supportsRtp: boolean; syncedAt: string }
export interface Preview { revision: string; changed: number; missing: number; unavailable: number; blocking: number; unmapped: number; unmappedItems: { uuid: string; name: string }[]; rows: { id: number; name: string; enabled: boolean; before: string | null; after: string | null; changed: boolean; level: string; issue: string | null; currencies: string[]; aliases: string[] }[] }
export type Change = ({ kind: 'provider' } & Omit<Provider, 'id'> & { id?: number })
  | ({ kind: 'game'; confirmed: true; sources: Omit<Source, 'gameId'>[] } & Omit<Game, 'id'> & { id?: number })
  | { kind: 'rule'; scope: Rule['scope']; targetId: number; aggregator: Aggregator | null }

async function call<T>(method: string, path: string, data?: unknown): Promise<T> {
  const res = await http.request<ApiResp<T>>({ method, url: `/admin/game-routing${path}`, ...(method === 'GET' ? { params: data } : { data }) })
  if (res.data.code !== 0) throw new Error(res.data.message)
  return res.data.data
}
export const getRouting = () => call<Config>('GET', '/')
export const getSources = (params: { aggregator?: Aggregator; provider?: string; search?: string; page?: number; pageSize?: number }) => call<{ items: SourceGame[]; total: number; providers: string[] }>('GET', '/sources', params)
export const getCandidates = (params: { providerId: number; search?: string; page?: number; pageSize?: number }) => call<{ items: { win: SourceGame; wx: SourceGame }[]; total: number }>('GET', '/candidates', params)
export const previewChange = (change: Change) => call<Preview>('POST', '/preview', change)
export const applyChange = (change: Change, revision: string, reason: string) => call('POST', '/apply', { change, revision, reason })
export const syncWxgame = () => call<{ received: number }>('POST', '/wxgame-sync')
