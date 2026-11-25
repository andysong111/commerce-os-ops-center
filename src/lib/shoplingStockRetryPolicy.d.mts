export const MAX_SHOPLING_STOCK_ATTEMPTS: 3;
export function isSafeShoplingStockRetry(result: {
  outcome?: unknown;
  evidence?: unknown;
  message?: unknown;
} | null | undefined): boolean;
