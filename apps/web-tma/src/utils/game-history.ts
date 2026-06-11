import type { SlotGame, GameHistoryItem } from '@/api/slots'

const STORAGE_KEY = 'betogo_game_history'
const MAX = 10

export function readLocalHistory(): GameHistoryItem[] {
  try {
    const r = localStorage.getItem(STORAGE_KEY)
    return r ? (JSON.parse(r) as GameHistoryItem[]) : []
  } catch { return [] }
}

export function writeLocalHistory(game: SlotGame): void {
  try {
    const existing = readLocalHistory().filter((g) => g.uuid !== game.uuid)
    const updated: GameHistoryItem[] = [
      {
        uuid: game.uuid, name: game.name, nameId: game.nameId,
        nameVi: game.nameVi, nameZh: game.nameZh, provider: game.provider,
        imageUrl: game.imageUrl, imageHqUrl: game.imageHqUrl,
        lastPlayedAt: new Date().toISOString(),
      },
      ...existing,
    ].slice(0, MAX)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch { /**/ }
}
