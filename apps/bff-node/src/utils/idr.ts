/** 活动配置初始化汇率：1 PHP = 287 IDR；IDR 金额统一四舍五入到百位。 */
export const PHP_TO_IDR_SEED = 287

export function toIdrHundred(phpAmount: number): number {
  if (phpAmount <= 0) return 0
  return Math.max(100, Math.round((phpAmount * PHP_TO_IDR_SEED) / 100) * 100)
}
