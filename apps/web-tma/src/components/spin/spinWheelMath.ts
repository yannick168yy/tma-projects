export const SPIN_ROTATION_MS = 7800
export const SPIN_FULL_TURNS = 6

export function computeSpinRotation(prev: number, prizeIndex: number, prizeCount: number): number {
  const segment = 360 / Math.max(1, prizeCount)
  const desired = (360 - prizeIndex * segment) % 360
  const current = ((prev % 360) + 360) % 360
  const delta = (desired - current + 360) % 360
  return prev + SPIN_FULL_TURNS * 360 + delta
}
