export type SourceOrderPurchaseCostEvidenceSeed = {
  barcode: string;
  modelNo: string;
  sourceProductName: string;
  sourceOptionName: string;
  expectedCatalogOptionLabel: string;
  unitCostKrw: number;
  costDate: string;
  sourceSheet: string;
  sourceRowNumber: number;
  sourceStatus:
    | "1688_ORDER_CONFIRMED"
    | "INBOUND_COMPLETE"
    | "SHIPPED"
    | "HISTORICAL_ORDER";
  mappingNote?: string;
  confidence: "A";
  evidenceClass: "SOURCE_ORDER_VERIFIED_COST_EVIDENCE";
  purchaseUseAllowed: true;
  priceUseAllowed: false;
  confirmedReceiptUseAllowed: false;
  inventoryWriteAllowed: false;
};

export const OCTOBER_2026_SOURCE_WORKBOOK = {
  id: "1b1qF2Zynaot96G8TeKaM7EgtqhwhKO4quuVm2Ti70Js",
  title: "동네일등 중국 주문,출발",
  url: "https://docs.google.com/spreadsheets/d/1b1qF2Zynaot96G8TeKaM7EgtqhwhKO4quuVm2Ti70Js/edit",
} as const;

const common = {
  confidence: "A",
  evidenceClass: "SOURCE_ORDER_VERIFIED_COST_EVIDENCE",
  purchaseUseAllowed: true,
  priceUseAllowed: false,
  confirmedReceiptUseAllowed: false,
  inventoryWriteAllowed: false,
} as const;

/**
 * Purchase-only evidence curated from the source workbook. Decimal KRW source
 * costs are rounded up so the evidence never understates the recorded unit cost.
 * Product Master identity is re-proved from the live planning snapshot before
 * any row can be imported.
 */
export const OCTOBER_2026_SOURCE_ORDER_PURCHASE_COST_EVIDENCE = [
  { ...common, barcode: "BAC1-1", modelNo: "AAA318", sourceProductName: "토끼 발세척매트", sourceOptionName: "그레이", expectedCatalogOptionLabel: "단품", unitCostKrw: 2281, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 7, sourceStatus: "1688_ORDER_CONFIRMED", mappingNote: "AAA318의 화이트 BAC1-3·핑크 BAC2-1과 함께 확인한 나머지 그레이 B-code" },
  { ...common, barcode: "BAC1-3", modelNo: "AAA318", sourceProductName: "토끼 발세척매트", sourceOptionName: "화이트", expectedCatalogOptionLabel: "화이트", unitCostKrw: 1848, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 8, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BAC2-1", modelNo: "AAA318", sourceProductName: "토끼 발세척매트", sourceOptionName: "핑크", expectedCatalogOptionLabel: "핑크", unitCostKrw: 1848, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 9, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BAC3-2", modelNo: "AAA381", sourceProductName: "노른자쉐이커 색상랜덤", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 2765, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 27, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BAD3-1", modelNo: "AAA042", sourceProductName: "투명코뽕", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 1021, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 11, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BAD5-2", modelNo: "AAA167", sourceProductName: "목견인기 L", sourceOptionName: "L", expectedCatalogOptionLabel: "단품", unitCostKrw: 1636, costDate: "2025-04-25", sourceSheet: "2025/04/25 출발 (LCL)", sourceRowNumber: 28, sourceStatus: "SHIPPED", mappingNote: "AAA167의 M은 BAD3-2이며 현재 단품 표기 BAD5-2는 L 옵션으로 확인" },
  { ...common, barcode: "BAF3-1", modelNo: "AAA044", sourceProductName: "합곡혈 지압기", sourceOptionName: "화이트", expectedCatalogOptionLabel: "단품", unitCostKrw: 627, costDate: "2025-03-28", sourceSheet: "2025/03/28 출발 (LCL)", sourceRowNumber: 35, sourceStatus: "SHIPPED", mappingNote: "Product Master의 AAA044 활성 B-code가 BAF3-1 한 개뿐인 단일 SKU 매핑" },
  { ...common, barcode: "BAF3-3", modelNo: "AAA031", sourceProductName: "코뽕블랙", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 600, costDate: "2024-04-15", sourceSheet: "2024/04/15", sourceRowNumber: 14, sourceStatus: "HISTORICAL_ORDER" },
  { ...common, barcode: "BAF4-1", modelNo: "AAA079", sourceProductName: "풋브러쉬 색상랜덤", sourceOptionName: "색상랜덤", expectedCatalogOptionLabel: "단품", unitCostKrw: 470, costDate: "2025-03-11", sourceSheet: "2025/03/11 출발 (LCL)", sourceRowNumber: 43, sourceStatus: "SHIPPED", mappingNote: "Product Master의 AAA079 활성 B-code가 BAF4-1 한 개뿐인 색상랜덤 SKU 매핑" },
  { ...common, barcode: "BAG4-1", modelNo: "AAA307", sourceProductName: "지압 스트레칭보드", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 3530, costDate: "2025-04-25", sourceSheet: "2025/04/25 출발 (LCL)", sourceRowNumber: 41, sourceStatus: "SHIPPED" },
  { ...common, barcode: "BBA1-1", modelNo: "AAA032", sourceProductName: "여드름 압출기 8종", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 1646, costDate: "2025-09-29", sourceSheet: "2025/09/29 주문시작(온돌패스)", sourceRowNumber: 84, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BBA7-2", modelNo: "AAA095", sourceProductName: "촘촘빗", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 78, costDate: "2025-10-01", sourceSheet: "2025/10/01 입고완료", sourceRowNumber: 49, sourceStatus: "INBOUND_COMPLETE" },
  { ...common, barcode: "BBB4-1", modelNo: "AAA382", sourceProductName: "세면대 실리콘물마개", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 34, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 21, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BBC5-1", modelNo: "AAA058", sourceProductName: "캥거루 장지갑", sourceOptionName: "블랙", expectedCatalogOptionLabel: "단품", unitCostKrw: 887, costDate: "2025-08-29", sourceSheet: "2025/08/29 입고완료", sourceRowNumber: 28, sourceStatus: "INBOUND_COMPLETE", mappingNote: "AAA058의 브라운 BBC5-2와 함께 확인한 나머지 블랙 B-code" },
  { ...common, barcode: "BBC5-2", modelNo: "AAA058", sourceProductName: "캥거루 장지갑", sourceOptionName: "브라운", expectedCatalogOptionLabel: "브라운", unitCostKrw: 887, costDate: "2025-08-29", sourceSheet: "2025/08/29 입고완료", sourceRowNumber: 29, sourceStatus: "INBOUND_COMPLETE" },
  { ...common, barcode: "BBC8-2", modelNo: "AAA075", sourceProductName: "플라워 손목핀쿠션 색상랜덤", sourceOptionName: "색상랜덤", expectedCatalogOptionLabel: "단품", unitCostKrw: 510, costDate: "2025-03-11", sourceSheet: "2025/03/11 출발 (LCL)", sourceRowNumber: 27, sourceStatus: "SHIPPED", mappingNote: "Product Master의 AAA075 활성 B-code가 BBC8-2 한 개뿐인 색상랜덤 SKU 매핑" },
  { ...common, barcode: "BBD3-1", modelNo: "AAA090", sourceProductName: "꿩안경", sourceOptionName: "중 사이즈", expectedCatalogOptionLabel: "단품", unitCostKrw: 27, costDate: "2025-03-11", sourceSheet: "2025/03/11 출발 (LCL)", sourceRowNumber: 21, sourceStatus: "SHIPPED", mappingNote: "AAA090의 대 1p는 BBD3-2이며 현재 단품 표기 BBD3-1은 중 사이즈 옵션으로 확인" },
  { ...common, barcode: "BBD4-1", modelNo: "AAA383", sourceProductName: "세면대 실버물마개 관통형", sourceOptionName: "A형", expectedCatalogOptionLabel: "단품", unitCostKrw: 65, costDate: "2025-10-01", sourceSheet: "2025/10/01 입고완료", sourceRowNumber: 17, sourceStatus: "INBOUND_COMPLETE", mappingNote: "AAA383의 비관통형 BBD4-2와 함께 확인한 나머지 관통형 B-code" },
  { ...common, barcode: "BBD4-2", modelNo: "AAA383", sourceProductName: "세면대 실버물마개 비관통형", sourceOptionName: "B형", expectedCatalogOptionLabel: "비관통형", unitCostKrw: 91, costDate: "2025-10-01", sourceSheet: "2025/10/01 입고완료", sourceRowNumber: 18, sourceStatus: "INBOUND_COMPLETE", mappingNote: "원장 B형은 Product Master 비관통형 옵션과 동일" },
  { ...common, barcode: "BCD3-1", modelNo: "AAA203", sourceProductName: "진자운동 모빌", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 1218, costDate: "2024-12-08", sourceSheet: "2024/12/08 출발", sourceRowNumber: 48, sourceStatus: "SHIPPED" },
  { ...common, barcode: "BCD5-1", modelNo: "AAA270", sourceProductName: "말발굽 고리링 골드", sourceOptionName: "골드", expectedCatalogOptionLabel: "골드", unitCostKrw: 130, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 29, sourceStatus: "1688_ORDER_CONFIRMED" },
  { ...common, barcode: "BEA1-1", modelNo: "AAA049", sourceProductName: "고릴라 인형", sourceOptionName: "15cm 600g", expectedCatalogOptionLabel: "단품", unitCostKrw: 1643, costDate: "2025-03-11", sourceSheet: "2025/03/11 출발 (LCL)", sourceRowNumber: 2, sourceStatus: "SHIPPED", mappingNote: "Product Master의 AAA049 활성 B-code가 BEA1-1 한 개뿐인 단일 SKU 매핑" },
  { ...common, barcode: "BGC3-1", modelNo: "AAA375", sourceProductName: "세탁기 청소솔", sourceOptionName: "단품", expectedCatalogOptionLabel: "단품", unitCostKrw: 472, costDate: "2026-06-01", sourceSheet: "2026/06/01 주문시작(온돌패스)", sourceRowNumber: 14, sourceStatus: "1688_ORDER_CONFIRMED" },
] as const satisfies readonly SourceOrderPurchaseCostEvidenceSeed[];

export const OCTOBER_2026_UNRESOLVED_LEGACY_COST_BARCODES = [
  "BAC3-3",
  "BAE4-1",
  "BBC1-2",
  "BBC4-1",
  "BCC6-2",
] as const;
