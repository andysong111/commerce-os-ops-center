import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const { buildPurchaseDraftBatchRecalculationHref } = await import(
  new URL("../src/lib/purchaseDraftBatchRecalculation.ts", import.meta.url)
);
const { mergePurchaseDraftOperatorAdjustments } = await import(
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

test("legacy commitment quantity pins stay visible even when already baked into the Draft quantity", () => {
  const persisted = {
    excludedBarcodes: [],
    quantityOverrides: [{ barcode: "BGG1-1", targetQuantity: 3_000 }],
  };
  const displayedQuantityOverrides = [];

  const merged = mergePurchaseDraftOperatorAdjustments(
    persisted,
    { excludedBarcodes: [], quantityOverrides: displayedQuantityOverrides },
  );

  assert.deepEqual(merged.quantityOverrides, [
    { barcode: "BGG1-1", targetQuantity: 3_000 },
  ]);
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

test("draft editor exposes one final calculation action and stages additions without writing", async () => {
  const workspace = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  );
  const addition = await readFile(
    "src/components/china-order-manager/InternalChinaManualDraftLineAdder.tsx",
    "utf8",
  );
  assert.match(workspace, /재고상태 저장 후 발주안 재계산/);
  assert.match(workspace, /대략 재고 \{stockBandUpdates\.length\}종 · 수량 변경 \{changedQuantityRows\.length\}종 · 수량 고정 해제 \{releasedQuantityOverrideBarcodes\.length\}종 · 제외 \{excludedBarcodes\.length\}종/);
  assert.match(workspace, /stockBandUpdates,/);
  assert.match(workspace, /많음/);
  assert.match(workspace, /보통/);
  assert.match(workspace, /적음/);
  assert.match(workspace, /품절/);
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
  assert.match(workspace, /filter\(\(\[barcode\]\) => !excludedBarcodes\.includes\(barcode\)\)/);
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
  assert.match(guide, /대략 재고 선택/);
  assert.match(guide, /수량 확인과 5·10단위 정리/);
  assert.match(guide, /빠진 B코드 수동 추가/);
  assert.match(guide, /발주안 한 번 재계산/);
  assert.match(guide, /5번 업무 실행/);
  assert.match(guide, /고정수량만으로 예산을 넘으면/);
  assert.match(guide, /localStorage\.getItem\(GUIDE_STORAGE_KEY\)/);
  assert.match(editor, /<InternalChinaPurchaseDraftGuide/);
  assert.match(editor, /manualAddPanel=/);
  assert.match(workspace, /hasPendingRecalculation \|\| calculations\.budgetOverKrw > 0/);
  assert.match(workspace, /상품대금 한도를[\s\S]*주문완료 기록을 막았습니다/);
  assert.match(workspace, /실제 위안단가와 중국 내 운임을 자동 반영하고 예산을 다시 검증/);
});

test("draft page loads legacy commitment pins before rendering the release control", async () => {
  const page = await readFile(
    "src/app/china-order-manager/drafts/[draftId]/page.tsx",
    "utf8",
  );
  assert.match(page, /loadPurchaseDraftOperatorAdjustments\(draftId\)/);
  assert.match(page, /mergePurchaseDraftOperatorAdjustments\(/);
  assert.match(page, /persistedAdjustments/);
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
  assert.match(
    service,
    /releasedQuantityOverrideBarcodes\.length === 0[\s\S]*excludedBarcodes\.length === 0/,
  );
  assert.match(route, /manualFallbackUsed/);
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
