import { enqueuePurchasePlanDraft } from "@/lib/purchasePlanDraftQueue";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductLaunchPurchaseMetadataByBarcode } from "@/lib/productLaunchPurchaseMetadata";

const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const ORDER_MANAGER_BASE_URL =
  "https://china-order-manager.andy123df23.chatgpt.site";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function handoffModelNumber(modelNo: unknown, barcode: string) {
  const candidate = text(modelNo);
  if (!candidate || /^LEGACY-/i.test(candidate)) return barcode;
  return candidate;
}

function koreanDate(iso: string) {
  const parsed = Date.parse(iso);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function queueFastPurchaseDraftForChina(rawDraftId: unknown) {
  const draftId = text(rawDraftId);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("FAST_PURCHASE_HANDOFF_DRAFT_ID_INVALID");
  }

  const [draftState, planning, trackerMetadata] = await Promise.all([
    loadFastPurchaseInternalDrafts(),
    loadProductPlanningSnapshot(),
    loadProductLaunchPurchaseMetadataByBarcode(),
  ]);
  if (draftState.error) {
    throw new Error("FAST_PURCHASE_HANDOFF_LEDGER_UNAVAILABLE");
  }
  const draft = draftState.drafts.find((row) => row.draftId === draftId);
  if (!draft) throw new Error("FAST_PURCHASE_HANDOFF_DRAFT_NOT_FOUND");
  if (!draft.lines.length || draft.openQuantity <= 0) {
    throw new Error("FAST_PURCHASE_HANDOFF_NO_OPEN_QUANTITY");
  }
  if (draft.orderedQuantity > 0 || draft.receivedQuantity > 0) {
    throw new Error("FAST_PURCHASE_HANDOFF_ALREADY_PROGRESSING");
  }
  if (draft.lines.some((line) => line.status !== "RESERVED" || line.openQuantity <= 0)) {
    throw new Error("FAST_PURCHASE_HANDOFF_NOT_RESERVED_ONLY");
  }

  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [text(row.barcode).toUpperCase(), row] as const),
  );

  const items = draft.lines
    .map((line) => {
      const profile = planningByBarcode.get(line.barcode);
      const tracker = trackerMetadata.byBarcode.get(line.barcode);
      const supplierLink = tracker?.conflict ? "" : text(tracker?.supplierLink);
      return {
        barcode: line.barcode,
        modelNumber: handoffModelNumber(profile?.modelNo, line.barcode),
        productName: text(profile?.productName) || line.barcode,
        saleOption: tracker?.conflict ? "" : text(tracker?.saleOption),
        chinaOption: tracker?.conflict ? "" : text(tracker?.chinaOption),
        supplierLink,
        quantity: quantity(line.openQuantity),
        unitCostKrw: 0,
        reason: `빠른 발주안 내부 Draft ${draftId} · 사용자 확정 RESERVED${
          supplierLink ? " · 상품출시진행관리 발주용 링크 자동연결" : ""
        }`,
      };
    })
    .filter((item) => item.quantity > 0)
    .sort((left, right) => left.barcode.localeCompare(right.barcode));

  if (!items.length) throw new Error("FAST_PURCHASE_HANDOFF_ITEMS_EMPTY");
  const queuedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  if (queuedQuantity !== draft.openQuantity) {
    throw new Error("FAST_PURCHASE_HANDOFF_QUANTITY_MISMATCH");
  }

  const result = await enqueuePurchasePlanDraft({
    sourceRunId: draftId,
    periodLabel: `${koreanDate(draft.updatedAt)} 빠른 발주안`,
    items,
  });
  const orderManagerUrl = new URL(ORDER_MANAGER_BASE_URL);
  orderManagerUrl.searchParams.set("purchaseDraftRun", draftId);

  return {
    draftId,
    lineCount: items.length,
    queuedQuantity,
    queueStatus: result.entry.status,
    alreadyQueued: result.alreadyQueued,
    alreadyImported: result.alreadyImported,
    batchId: result.entry.batchId,
    orderManagerUrl: orderManagerUrl.toString(),
    externalOrderExecuted: false as const,
    trackerMetadataError: trackerMetadata.error,
    items,
  };
}
