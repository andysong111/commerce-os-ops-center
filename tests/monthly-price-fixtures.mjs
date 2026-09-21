export const goodsKey = '1234567';
export const runId = '11111111-1111-4111-8111-111111111111';
export const itemId = '22222222-2222-4222-8222-222222222222';
export function fixture() {
  const draftId = 'fast-purchase-draft:0123456789abcdef0123', receiptId = '33333333-3333-4333-8333-333333333333';
  const draft = { draftId, cycleMonth: '2026-09', savedAt: '2026-09-01T00:00:00Z', exchangeRateKrwPerCny: 230,
    lines: [{ barcode: 'ABC1-1', quantity: 10, unitPriceCny: 5, domesticChinaFreightCny: 10, freightGroupId: 'order1' }] };
  const close = { draftId, cycleMonth: '2026-09', closedAt: '2026-09-10T00:00:00Z', actualCostKrw: 1150, productPurchaseCostKrw: 11500, domesticChinaFreightKrw: 2300, actualMultiplier: 1.1 };
  const receiptRows = [{ input_snapshot: { sourceRunId: draftId, sourceSystem: 'fast-purchase-mvp', barcode: 'ABC1-1', status: 'RECEIVED', payload: { receiptId, draftId, cycleMonth: '2026-09', receivedNow: 10 } },
    result_snapshot: { draftId, cycleMonth: '2026-09', barcode: 'ABC1-1', receiptId, receivedNow: 10,
      receiptCost: { id: `china-receipt:${receiptId}:ABC1-1`, receiptId, barcode: 'ABC1-1', quantity: 10, unitCostKrw: 1380 } } }];
  return { draft, close, receiptRows };
}
export function candidate(cost = 1500) { return { goodsKey, productName: 'fixture', productGroup: '도매4', inventoryCostBasis: 'LEGACY_MIXED_UNRESOLVED', options: [{ barcode: 'ABC1-1', optionId: '11', unitsPerOrder: 1, currentCostKrw: cost, protectedCostKrw: cost }], reason: null }; }
export function live(price = 1000) { return [{ goods_key: goodsKey, optId: '11', optAmt: '0', sale_price: String(price), org_price: '321', list_price: '6543', sale_status: 'B' }]; }
export function observation(price = 1000) { return { goodsKey, pageUrl: `https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=price_chg&prod_id=${goodsKey}`, observedAt: Date.now(), rows: [{ mallKey: 'SMALL_00069', source: 'header', sellPrice: price, purchasePrice: 222, consumerPrice: 7777 }] }; }
