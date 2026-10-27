export const MAX_SEO_BULK_SELECTION = 50;

export const PRODUCT_LAUNCH_PRIORITY_BATCHES = Object.freeze([
  "제작 예정 상품들",
  "등록완료건",
  "신규소싱확정",
]);

export function availableProductLaunchPriorityBatches(values) {
  const available = new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  return PRODUCT_LAUNCH_PRIORITY_BATCHES.filter((value) => available.has(value));
}

export function isProductLaunchSeoBulkSelectable(item) {
  return Boolean(
    item &&
      item.seoExclusion?.excluded !== true &&
      item.stockAvailability?.selectable === true &&
      item.receiptPending !== true &&
      item.readiness?.ready === true,
  );
}

export function selectProductLaunchSeoBulkItems(
  items,
  limit = MAX_SEO_BULK_SELECTION,
) {
  const safeLimit = Math.max(0, Math.min(MAX_SEO_BULK_SELECTION, Math.trunc(Number(limit)) || 0));
  return (Array.isArray(items) ? items : [])
    .filter(isProductLaunchSeoBulkSelectable)
    .slice(0, safeLimit);
}
