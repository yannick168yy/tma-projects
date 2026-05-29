/**
 * 加权随机采样（无放回）
 *
 * 分数越高被选中概率越大，但低分游戏也有机会出现。
 * 内部对原始分数做 ^1.5 幂次放大，使高分游戏优势更明显。
 *
 * @param pool         候选池
 * @param getScore     返回原始分数（phBonus 或 weight），含 featured 加成
 * @param n            目标数量
 * @param maxPerProvider 同一供应商最多入选数（默认 2）
 */
export function weightedSample<T extends { provider: string }>(
  pool: T[],
  getScore: (item: T) => number,
  n: number,
  maxPerProvider = 2,
): T[] {
  // 计算有效权重（幂次曲线，保证最小值 > 0）
  const weighted = pool.map((item) => ({
    item,
    w: Math.pow(Math.max(getScore(item), 0.1), 1.5),
  }))

  // 加权无放回采样：取 n*3 个候选（供应商去重后至少能凑够 n 个）
  const sampleSize = Math.min(n * 3, weighted.length)
  const candidates: T[] = []
  const remaining = [...weighted]

  while (candidates.length < sampleSize && remaining.length > 0) {
    const total = remaining.reduce((s, x) => s + x.w, 0)
    let rand = Math.random() * total
    let idx = remaining.length - 1
    for (let i = 0; i < remaining.length; i++) {
      rand -= remaining[i].w
      if (rand <= 0) { idx = i; break }
    }
    candidates.push(remaining[idx].item)
    remaining.splice(idx, 1)
  }

  // 供应商去重：同一供应商最多 maxPerProvider 款
  const result: T[] = []
  const providerCount = new Map<string, number>()

  for (const item of candidates) {
    if (result.length >= n) break
    const c = providerCount.get(item.provider) ?? 0
    if (c < maxPerProvider) {
      result.push(item)
      providerCount.set(item.provider, c + 1)
    }
  }

  return result
}
