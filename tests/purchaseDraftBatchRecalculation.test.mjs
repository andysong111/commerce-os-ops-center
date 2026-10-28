import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const { buildPurchaseDraftBatchRecalculationHref } = await import(
  new URL("../src/lib/purchaseDraftBatchRecalculation.ts", import.meta.url)
);
const {
  confirmedPurchaseDraftOperatorAdjustments,
  mergePurchaseDraftOperatorAdjustments,
} = await import(
  new URL("../src/lib/purchaseCycleDraftRegenerationCore.ts", import.meta.url)
);

test("draft recalculation keeps prior exclusions and pinned quantities", () => {
  const merged = mergePurchaseDraftOperatorAdjustments(
    {
      excludedBarcodes: ["BAF3-1", "BAB5-1"],
      quantityOverrides: [{ barcode: "BGG1-1", targetQuantity: 3_000 }],
    },
    {
      excludedBarcodes: ["BBA7-2"],
      quantityOverrides: [
        { barcode: "BGG1-1", targetQuantity: 3_000 },
        { barcode: "BAC1-1", targetQuantity: 50 },
      ],
    },
  );

  assert.deepEqual(merged, {
    excludedBarcodes: ["BAB5-1", "BAF3-1", "BBA7-2"],
    quantityOverrides: [
      { barcode: "BAC1-1", targetQuantity: 50 },
      { barcode: "BGG1-1", targetQuantity: 3_000 },
    ],
  });
});

test("draft recalculation can replace the full pinned quantity set", () => {
  const merged = mergePurchaseDraftOperatorAdjustments(
    {
      excludedBarcodes: ["BAF3-1"],
      quantityOverrides: [{ barcode: "BGG1-1", targetQuantity: 3_000 }],
    },
    {
      excludedBarcodes: [],
      quantityOverrides: [{ barcode: "BAC1-1", targetQuantity: 50 }],
    },
    { replaceQuantityOverrides: true },
  );

  assert.deepEqual(merged, {
    excludedBarcodes: ["BAF3-1"],
    quantityOverrides: [{ barcode: "BAC1-1", targetQuantity: 50 }],
  });
});

test("v3 explicit manual pins survive while trusted manual additions stay fixed", () => {
  const adjustments = {
    excludedBarcodes: ["BAF3-1"],
    quantityOverrides: [
      { barcode: "BGG1-1", targetQuantity: 7_910 },
      { barcode: "BAC1-1", targetQuantity: 50 },
      { barcode: "BAA9-1", targetQuantity: 25 },
    ],
  };

  const confirmed = confirmedPurchaseDraftOperatorAdjustments([
    {
      adjustments,
      lineBarcode: "BGG1-1",
      confirmedQuantityOverrideBarcodes: ["BAC1-1"],
      quantityOverrideProvenanceVersion: 3,
    },
    {
      adjustments,
      lineBarcode: "BAA9-1",
      quantityOverrideProvenanceVersion: 3,
      manualAddition: true,
      manualAdditionProvenanceVersion: 2,
    },
  ]);

  assert.deepEqual(confirmed, {
    excludedBarcodes: ["BAF3-1"],
    quantityOverrides: [
      { barcode: "BAA9-1", targetQuantity: 25 },
      { barcode: "BAC1-1", targetQuantity: 50 },
    ],
  });
});

test("contaminated v2 quantity pins return to policy", () => {
  const adjustments = {
    excludedBarcodes: [],
    quantityOverrides: [
      { barcode: "BAA1-2", targetQuantity: 5 },
      { barcode: "BAA2-1", targetQuantity: 10 },
    ],
  };

  const confirmed = confirmedPurchaseDraftOperatorAdjustments([
    {
      adjustments,
      lineBarcode: "BAA1-2",
      confirmedQuantityOverrideBarcodes: ["BAA1-2", "BAA2-1"],
      quantityOverrideProvenanceVersion: 2,
    },
    {
      adjustments,
      lineBarcode: "BAA2-1",
      confirmedQuantityOverrideBarcodes: ["BAA1-2", "BAA2-1"],
      quantityOverrideProvenanceVersion: 2,
    },
  ]);

  assert.deepEqual(confirmed, {
    excludedBarcodes: [],
    quantityOverrides: [],
  });
});

test("contaminated pre-v2 confirmation and manual-add flags return to policy", () => {
  const adjustments = {
    excludedBarcodes: [],
    quantityOverrides: [
      { barcode: "BGG1-1", targetQuantity: 7_910 },
      { barcode: "BAA9-1", targetQuantity: 25 },
    ],
  };

  const confirmed = confirmedPurchaseDraftOperatorAdjustments([
    {
      adjustments,
      lineBarcode: "BGG1-1",
      confirmedQuantityOverrideBarcodes: ["BGG1-1", "BAA9-1"],
    },
    {
      adjustments,
      lineBarcode: "BAA9-1",
      confirmedQuantityOverrideBarcodes: ["BGG1-1", "BAA9-1"],
      manualAddition: true,
    },
  ]);

  assert.deepEqual(confirmed, {
    excludedBarcodes: [],
    quantityOverrides: [],
  });
});

test("batch recalculation carries quantity edits, exclusions, and additions in one request", () => {
  const href = buildPurchaseDraftBatchRecalculationHref({
    regenerationHref: "/purchase-cycle-preflight?check=1&replace=fast-purchase-draft%3Aabc",
    origin: "https://commerce-os.example",
    excludedBarcodes: ["BAD1-1"],
    quantityOverrides: [
      { barcode: "BAC1-1", targetQuantity: 38 },
      { barcode: "BAE5-1", targetQuantity: 12 },
    ],
  });
  const url = new URL(href, "https://commerce-os.example");
  assert.deepEqual(url.searchParams.getAll("exclude"), ["BAD1-1"]);
  assert.deepEqual(url.searchParams.getAll("qty"), ["BAC1-1:38", "BAE5-1:12"]);
  assert.equal(url.searchParams.get("replace"), "fast-purchase-draft:abc");
});

test("excluded products cannot also be fixed as quantity additions", () => {
  const href = buildPurchaseDraftBatchRecalculationHref({
    regenerationHref: "/purchase-cycle-preflight?exclude=OLD1-1&qty=OLD1-1%3A9",
    origin: "https://commerce-os.example",
    excludedBarcodes: ["BAD1-1", "bad1-1"],
    quantityOverrides: [
      { barcode: "BAD1-1", targetQuantity: 30 },
      { barcode: "BAC1-1", targetQuantity: 0 },
      { barcode: "BAE5-1", targetQuantity: 15 },
    ],
  });
  const url = new URL(href, "https://commerce-os.example");
  assert.deepEqual(url.searchParams.getAll("exclude"), ["BAD1-1"]);
  assert.deepEqual(url.searchParams.getAll("qty"), ["BAE5-1:15"]);
});

test("draft editor exposes persistent and final calculation actions and stages additions without writing", async () => {
  const workspace = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  );
  const addition = await readFile(
    "src/components/china-order-manager/InternalChinaManualDraftLineAdder.tsx",
    "utf8",
  );
  assert.match(workspace, /재고상태 저장 후 발주안 재계산/);
  assert.match(workspace, /대략 재고 \{stockBandUpdates\.length\}종 · 단종예정 \{discontinuedBarcodes\.length\}종 · 수량 변경 \{changedQuantityRows\.length\}종 · 수량 고정 해제 \{releasedQuantityOverrideBarcodes\.length\}종 · 제외 \{excludedBarcodes\.length\}종/);
  assert.match(workspace, /stockBandUpdates,/);
  assert.match(workspace, /많음/);
  assert.match(workspace, /보통/);
  assert.match(workspace, /적음/);
  assert.match(workspace, /품절/);
  assert.match(workspace, /단종예정/);
  assert.match(workspace, /discontinuedBarcodes,/);
  assert.match(workspace, /모델명 ·/);
  assert.match(workspace, /모델번호 ·/);
  assert.match(workspace, /옵션명 ·/);
  assert.match(workspace, /선택 수량 고정 해제/);
  assert.match(workspace, /replaceQuantityOverrides: true/);
  assert.match(workspace, /fetch\("\/api\/purchase-cycle\/preflight-draft\/recalculate"/);
  assert.doesNotMatch(
    workspace,
    /await persistDraft\(\{ quiet: true, syncMetadata: false, refresh: false \}\)/,
  );
  assert.match(workspace, /recalculationNotice/);
  assert.match(workspace, /new URL\(\s*`\/china-order-manager\/drafts\//);
  assert.match(workspace, /router\.replace\(`\$\{destination\.pathname\}\$\{destination\.search\}`\)/);
  assert.doesNotMatch(workspace, /대기 중인 변경을 현재 Draft에 바로 반영할까요/);
  assert.doesNotMatch(workspace, /router\.push\(buildPurchaseDraftBatchRecalculationHref/);
  assert.match(workspace, /step=\{5\}/);
  assert.match(workspace, /isPurchaseDraftQuantityUnit\(targetQuantity\)/);
  assert.match(workspace, /!excludedBarcodes\.includes\(barcode\)[\s\S]*!discontinuedBarcodes\.includes\(barcode\)/);
  assert.doesNotMatch(workspace, /regenerateWithoutSelected|regenerateWithQuantityChanges/);
  assert.doesNotMatch(addition, /method: "POST"|postAdd\(/);
  assert.match(addition, /재계산 전 원장 미변경/);
  assert.match(addition, /사용자 고정수량/);
  assert.match(addition, /isPurchaseDraftQuantityUnit/);
  assert.match(addition, /min=\{5\}/);
  assert.match(addition, /max=\{9995\}/);
  assert.match(addition, /step=\{5\}/);
  assert.match(workspace, /stagedAdditions\.map\(\(row\) => \[row\.barcode, row\.targetQuantity\]\)/);
  assert.match(workspace, /사용자 고정수량의 예산을 먼저 확보/);
  assert.match(workspace, /data-persistent-recalculation-action/);
  assert.match(workspace, /\{manualAddPanel\}[\s\S]*변경사항 저장 후 발주안 재계산/);
});

test("draft guide explains the operator sequence and actual-price budget gate", async () => {
  const guide = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftGuide.tsx",
    "utf8",
  );
  const editor = await readFile(
    "src/components/china-order-manager/InternalChinaDraftBatchEditor.tsx",
    "utf8",
  );
  const workspace = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  );

  assert.match(guide, /작업 순서 보기/);
  assert.match(workspace, /재고를 빼기 전 임시 추천치/);
  assert.match(workspace, /파란색 · 재계산 대기/);
  assert.match(workspace, /초록색 · 저장·적용 완료/);
  assert.match(workspace, /초록색 선택은 다음 차시 재사용을 위한 기록/);
  assert.match(guide, /aria-haspopup="dialog"/);
  assert.match(guide, /aria-expanded=\{open\}/);
  assert.match(guide, /fixed right-4 top-24 z-\[80\]/);
  assert.match(guide, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(guide, /기존 주문초안 날짜 확인/);
  assert.match(guide, /중국 주문초안 · 날짜/);
  assert.match(guide, /새 판매자료로 발주 시작/);
  assert.match(guide, /날짜가 지난 미주문 초안은 새 초안으로 교체/);
  assert.match(guide, /대략 재고 선택/);
  assert.match(guide, /수량 확인과 5·10단위 정리/);
  assert.match(guide, /빠진 B코드 수동 추가/);
  assert.match(guide, /발주안 한 번 재계산/);
  assert.match(guide, /재계산 후 초록색 재고 선택이 남는 것은 정상/);
  assert.match(guide, /5-1 원가·운임 기록/);
  assert.match(guide, /5-2 장바구니 담기/);
  assert.match(guide, /주문 제출과 결제는 실행하지 않습니다/);
  assert.match(guide, /입고확정일 다음 날이 아니라, 가장 최근 입고확정 완료 차시의 계산 시작일 다음 날/);
  assert.match(guide, /localStorage\.getItem\(GUIDE_STORAGE_KEY\)/);
  assert.match(editor, /<InternalChinaPurchaseDraftGuide/);
  assert.match(editor, /manualAddPanel=/);
  assert.match(workspace, /hasPendingRecalculation \|\| calculations\.budgetOverKrw > 0/);
  assert.match(workspace, /상품대금 한도를[\s\S]*주문완료 기록을 막았습니다/);
  assert.match(workspace, /실제 위안단가와 중국 내 운임을 자동 반영했습니다\. 예산도 다시 검증/);
});

test("draft page loads legacy commitment pins before rendering the release control", async () => {
  const page = await readFile(
    "src/app/china-order-manager/drafts/[draftId]/page.tsx",
    "utf8",
  );
  assert.match(page, /loadPurchaseDraftOperatorAdjustments\(draftId\)/);
  assert.match(page, /persistedAdjustments/);
  assert.match(page, /initialQuantityOverrides = persistedAdjustments\.quantityOverrides/);
  assert.doesNotMatch(page, /displayedQuantityOverrides/);
  assert.match(page, /initialQuantityOverrides=\{initialQuantityOverrides\}/);
});

test("inline recalculation endpoint replaces the reserved draft without rendering preflight", async () => {
  const route = await readFile(
    "src/app/api/purchase-cycle/preflight-draft/recalculate/route.ts",
    "utf8",
  );
  const service = await readFile(
    "src/lib/purchaseCyclePreflightDraft.ts",
    "utf8",
  );
  assert.match(route, /recalculatePurchaseCycleDraftInline/);
  assert.match(route, /externalOrderExecuted: false/);
  assert.match(service, /preserveExistingSourcingOnly: true/);
  assert.match(service, /regenerateValidatedMonthlyPurchaseDraft/);
  assert.match(service, /regenerateManualMonthlyPurchaseDraft/);
  assert.match(service, /releasedQuantityOverrideBarcodes,/);
  assert.match(service, /operatorStockBandUpdates: stockBandUpdates/);
  assert.match(service, /operatorStockBandOccurredAt: stockBandStorage\.occurredAt/);
  assert.match(service, /stockBandUpdates\.length > 0/);
  assert.match(
    service,
    /releasedQuantityOverrideBarcodes\.length === 0[\s\S]*excludedBarcodes\.length === 0/,
  );
  assert.match(route, /manualFallbackUsed/);
  assert.match(route, /초록색 재고 선택은 저장·적용 완료 기록/);
});

test("manual fallback removes released legacy pins without persisting a permanent exclusion", async () => {
  const regeneration = await readFile(
    "src/lib/purchaseCycleDraftRegeneration.ts",
    "utf8",
  );
  assert.match(
    regeneration,
    /\.\.\.input\.excludedBarcodes,[\s\S]*\.\.\.\(input\.releasedQuantityOverrideBarcodes \?\? \[\]\)/,
  );
  assert.match(
    regeneration,
    /operatorExcludedBarcodes: input\.excludedBarcodes/,
  );
});
