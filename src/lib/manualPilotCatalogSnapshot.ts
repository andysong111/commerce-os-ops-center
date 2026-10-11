import type { ManualPilotCatalog, ManualPilotCatalogCandidate } from "./sourcingBudgetPlan";

const SELECTION_RUN_ID = "92fc558e-bd75-4181-8db0-2e07276b304e";
const GENERATED_AT = "2026-10-11T12:16:22.838Z";

function candidate(input: {
  conceptId: string;
  canonicalNameKo: string;
  rawItemId: string;
  offerId: string;
  skuLabel: string;
  variantKey: string;
  unitPriceCny: number;
  moq: number;
  aiDetailPreflightStatus?: ManualPilotCatalogCandidate["aiDetailPreflightStatus"];
}): ManualPilotCatalogCandidate {
  return {
    conceptId: input.conceptId,
    canonicalNameKo: input.canonicalNameKo,
    sourceUrl: `https://detail.1688.com/offer/${input.offerId}.html`,
    rawItemId: input.rawItemId,
    offerId: input.offerId,
    skuLabel: input.skuLabel,
    lane: input.aiDetailPreflightStatus === "CONDITIONAL" ? "AI_CONDITIONAL" : "EVIDENCE_GAP",
    strictTestReady: false,
    reviewRequired: true,
    automaticOrderAllowed: false,
    finalQualityScore: null,
    marketDemandScore: null,
    unitPriceCny: input.unitPriceCny,
    moq: input.moq,
    plannedCostKrw: null,
    minimumPilotCapitalKrw: null,
    targetSellingPriceKrw: null,
    aiDetailPreflightStatus: input.aiDetailPreflightStatus ?? "PENDING",
    variants: [{
      variantKey: input.variantKey,
      saleOption: "기준 옵션",
      chinaOption: input.skuLabel,
      unitPriceCny: input.unitPriceCny,
      source: "VISIBLE_1688_OPTION",
      defaultStorageSize: null,
    }],
  };
}

const candidates: ManualPilotCatalogCandidate[] = [
  candidate({
    conceptId: "73e401ea-93cd-4030-9a2b-778db7533e69",
    canonicalNameKo: "가정용 조절형 틈새 청소 브러시",
    rawItemId: "1049cc85-ac26-4c81-8ee1-974502a65dd4",
    offerId: "1082973872659",
    skuLabel: "可伸缩清洁刷",
    variantKey: "direct-variant-v1:ecc98f6211db49a98da6",
    unitPriceCny: 2.8,
    moq: 2,
    aiDetailPreflightStatus: "CONDITIONAL",
  }),
  candidate({
    conceptId: "922a965d-3159-40b3-9f1c-f921b66a1e38",
    canonicalNameKo: "데이터케이블 보관케이스",
    rawItemId: "656039a8-de9b-412c-babc-ee809f94c87c",
    offerId: "805861604240",
    skuLabel: "充电线绕线器-橙色-大号",
    variantKey: "direct-variant-v1:917ae6cc93b0766b739a",
    unitPriceCny: 2.82,
    moq: 2,
  }),
  candidate({
    conceptId: "168b6d6c-1602-42d5-94c6-08edc869edd2",
    canonicalNameKo: "브러시 손잡이형",
    rawItemId: "62a709d3-516c-4237-b7ba-8b243d76e615",
    offerId: "1068780276550",
    skuLabel: "黑红塑料手柄清洁刷",
    variantKey: "direct-variant-v1:f6dad4bb66381e7b8b5c",
    unitPriceCny: 0.57,
    moq: 1,
  }),
  candidate({
    conceptId: "1991190f-65c6-49b1-84bf-6ecef59b5b55",
    canonicalNameKo: "수건행거 벽걸이 선반",
    rawItemId: "0642b8d2-aa25-4c9a-8a62-967b6eff7f78",
    offerId: "680321187119",
    skuLabel: "上门安装 +",
    variantKey: "direct-variant-v1:2e656fcf4e612ed78583",
    unitPriceCny: 150,
    moq: 1,
    aiDetailPreflightStatus: "READY",
  }),
  candidate({
    conceptId: "dba531d5-ad22-4f35-a4bf-6b4b1ffaad64",
    canonicalNameKo: "수납박스 손잡이형",
    rawItemId: "b65d409e-5be7-4698-90f3-b033aac0f24f",
    offerId: "967294653668",
    skuLabel: "长条收纳盒透明",
    variantKey: "direct-variant-v1:ea4ce5dc18d86daccf6c",
    unitPriceCny: 1.64,
    moq: 2,
  }),
  candidate({
    conceptId: "faf34ab0-e2b3-4421-bcd6-567f4317adc1",
    canonicalNameKo: "케이블 정리함 탁하부형",
    rawItemId: "ff5004b7-7379-4757-a9c1-0f4aabf7dc39",
    offerId: "996820998844",
    skuLabel: "黑色双层伸缩款【40-74CM】",
    variantKey: "direct-variant-v1:9ed930a4ba3622f14535",
    unitPriceCny: 51.55,
    moq: 1,
  }),
  candidate({
    conceptId: "f23262ba-4638-4630-9d1c-f1755043a088",
    canonicalNameKo: "투명 수납박스 슬림형",
    rawItemId: "331702be-e22f-4b96-82de-8014378edc4f",
    offerId: "994814633153",
    skuLabel: "pet桌面收纳盒",
    variantKey: "direct-variant-v1:aedc410bf067c6b48302",
    unitPriceCny: 1.35,
    moq: 2,
  }),
  candidate({
    conceptId: "3ce77614-39b4-493f-8924-7416d2be2c9f",
    canonicalNameKo: "투명 파우치 4종 세트",
    rawItemId: "233e7a70-62aa-443d-9370-80af1bec4fab",
    offerId: "1056397065563",
    skuLabel: "大号【适合收纳空调被/婴儿被等】 1个装【TPU材质 加厚耐磨 防水防潮】",
    variantKey: "direct-variant-v1:3b2297926e02e57c786e",
    unitPriceCny: 6.4,
    moq: 1,
  }),
  candidate({
    conceptId: "d5893fc2-7cfe-4c0e-bf84-e4d94f4f61b9",
    canonicalNameKo: "투명 플라스틱 서랍형 수납함",
    rawItemId: "723e6a76-a92e-4a6d-8057-03d69d3dbe3e",
    offerId: "677122530258",
    skuLabel: "【深53】*48*35cm有卡扣 90L",
    variantKey: "direct-variant-v1:1303e2eb82c03ca7106e",
    unitPriceCny: 80.66,
    moq: 1,
  }),
];

export function readManualPilotCatalogSnapshot(): ManualPilotCatalog {
  return {
    version: "manual-pilot-integration-catalog-v1",
    generatedAt: GENERATED_AT,
    selectedConceptCount: candidates.length,
    availableCandidateCount: candidates.length,
    unavailableConceptIds: [],
    candidates,
    sourceFingerprint: "sha256:e289abe3041d46836ffa96e73f93e49a76aefd1f1fbea5bf3d0c821b6804d90a",
    snapshotFallback: true,
    selectionRunId: SELECTION_RUN_ID,
    businessWritesEnabled: false,
    externalOrderExecuted: false,
  };
}
