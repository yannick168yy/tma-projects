export function localizedGameName(
  game: { name: string; nameId?: string | null; nameVi?: string | null; nameZh?: string | null },
  locale: string,
): string {
  if (locale === 'id' && game.nameId) return game.nameId
  if (locale === 'vi' && game.nameVi) return game.nameVi
  if (locale === 'zh-CN' && game.nameZh) return game.nameZh
  return game.name
}
