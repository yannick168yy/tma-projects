/** 活动配置初始化汇率：1 PHP = 1.53 INR（由 USDT_TO_INR_RATE / USDT_TO_PHP_RATE 推导）。 */
export const PHP_TO_INR_SEED = 1.53

/**
 * PHP 配置值换算成 INR 并阶梯取整：≥1000 取百位，100~999 取十位，<100 取个位。
 * 1 PHP 只合 1.53 INR，一律取整到百位会把 ₱20 这种小额档位放大到 ₹100（≈₱65）。
 */
export function toInrRounded(phpAmount: number): number {
  if (phpAmount <= 0) return 0
  const raw = phpAmount * PHP_TO_INR_SEED
  if (raw >= 1000) return Math.round(raw / 100) * 100
  if (raw >= 100) return Math.round(raw / 10) * 10
  return Math.max(1, Math.round(raw))
}
