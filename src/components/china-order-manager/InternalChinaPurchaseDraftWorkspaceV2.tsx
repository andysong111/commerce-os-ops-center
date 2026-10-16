"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { internalChinaOrderEvidenceIssues } from "@/lib/internalChinaOrderEvidence";
import type { StagedDraftAddition } from "@/components/china-order-manager/InternalChinaManualDraftLineAdder";
import type { InternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import type {
  InternalChinaPurchaseDraft,
  InternalChinaPurchaseDraftLine,
} from "@/lib/internalChinaPurchaseDraft";
import type { PurchaseQuantityOverride } from "@/lib/purchaseCyclePreflightCore";
import {
  isPurchaseDraftQuantityUnit,
  nearestPurchaseDraftQuantity,
} from "@/lib/purchaseDraftQuantityRounding";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const cny = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const TABLE_COLUMNS = [
  { label: "B-code / 모델 / 옵션", width: 280 },
  { label: "중국옵션 · 역저장", width: 240 },
  { label: "모델 고정 1번 1688 링크 · 역저장", width: 460 },
  { label: "수량 · 계산 대기", width: 190 },
  { label: "위안단가", width: 130 },
  { label: "운임그룹", width: 180 },
  { label: "중국내 운임", width: 150 },
  { label: "개당 운임", width: 100 },
  { label: "최종단가 CNY", width: 110 },
  { label: "실주문원가 KRW", width: 120 },
  { label: "내부기준원가 KRW", width: 130 },
  { label: "1688 주문번호", width: 160 },
  { label: "메모", width: 260 },
] as const;

const TABLE_WIDTH = TABLE_COLUMNS.reduce((sum, column) => sum + column.width, 0);
const PREPARATION_NOTE_PREFIX = "[1688 준비 제외]";

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function cnyCent(value: unknown) {
  return Math.round(decimal(value) * 100) / 100;
}

function lineKey(line: InternalChinaPurchaseDraftLine) {
  return line.freightGroupId.trim() || `__${line.barcode}`;
}

function modelKey(line: Pick<InternalChinaPurchaseDraftLine, "modelNo" | "barcode">) {
  return line.modelNo.trim().toUpperCase() || line.barcode.trim().toUpperCase();
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function supplierPageKey(value: string) {
  try {
    const url = new URL(value.trim());
    const offerFromPath = url.pathname.match(/\/offer\/(\d+)/i)?.[1];
    const offerId = offerFromPath || url.searchParams.get("offerId") || "";
    if (offerId) return `1688-${offerId}`;
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

function purchaseEvidenceSignature(draft: InternalChinaPurchaseDraft) {
  return draft.lines
    .map((line) => [
      line.barcode,
      decimal(line.unitPriceCny),
      line.freightGroupId.trim(),
      decimal(line.domesticChinaFreightCny),
    ].join("\u0000"))
    .sort()
    .join("\u0001");
}

function stickyCellStyle(index: number, freezeThrough: number, header = false): CSSProperties | undefined {
  if (freezeThrough < 0 || index > freezeThrough) return undefined;
  const left = TABLE_COLUMNS.slice(0, index).reduce((sum, column) => sum + column.width, 0);
  return {
    position: "sticky",
    left,
    zIndex: header ? 55 : 25,
    backgroundColor: header ? "#f8fafc" : "#ffffff",
    boxShadow: index === freezeThrough ? "2px 0 0 rgba(148,163,184,0.45)" : undefined,
  };
}

type DraftSaveResponse = {
  ok?: boolean;
  message?: string;
  draft?: InternalChinaPurchaseDraft;
};

type DraftRecalculationResponse = DraftSaveResponse & {
  code?: string;
  previousDraftId?: string;
  addedCount?: number;
  removedCount?: number;
  changedCount?: number;
};

type MetadataSyncResponse = DraftSaveResponse & {
  productMasterSynced?: boolean;
  productMasterError?: string | null;
  warnings?: string[];
  syncedModels?: number;
  syncedBcodes?: number;
};

type FreightGroupInfo = {
  key: string;
  members: InternalChinaPurchaseDraftLine[];
  leaderBarcode: string;
  totalFreight: number;
};

export function InternalChinaPurchaseDraftWorkspaceV2({
  initialDraft,
  budgetAudit,
  regenerationHref,
  initialQuantityOverrides = [],
  initialNotice = "",
  stagedAdditions,
  onStagedAdditionsChange,
}: {
  initialDraft: InternalChinaPurchaseDraft;
  budgetAudit: InternalChinaPurchaseBudgetAudit;
  regenerationHref: string;
  initialQuantityOverrides?: PurchaseQuantityOverride[];
  initialNotice?: string;
  stagedAdditions: StagedDraftAddition[];
  onStagedAdditionsChange: (rows: StagedDraftAddition[]) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [notice, setNotice] = useState(initialNotice);
  const [saving, setSaving] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [stagedExclusions, setStagedExclusions] = useState<Record<string, boolean>>({});
  const [persistedQuantityOverrides] = useState<Record<string, number>>(
    () => Object.fromEntries(initialQuantityOverrides.map((row) => [row.barcode, row.targetQuantity])),
  );
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  const [regenerating, setRegenerating] = useState(false);
  const [cartPreparing, setCartPreparing] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(TABLE_WIDTH);
  const [freezeThrough, setFreezeThrough] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const cartRefreshDeadlineRef = useRef(0);
  const cartEvidenceRef = useRef(purchaseEvidenceSignature(initialDraft));

  useEffect(() => {
    let disposed = false;
    let refreshing = false;

    const refreshCartEvidence = async () => {
      if (disposed || refreshing || Date.now() > cartRefreshDeadlineRef.current) return;
      refreshing = true;
      try {
        const response = await fetch(
          `/api/china-order-manager/drafts/${encodeURIComponent(initialDraft.draftId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        const body = (await response.json().catch(() => ({}))) as DraftSaveResponse;
        if (!response.ok || !body.ok || !body.draft) return;
        const nextSignature = purchaseEvidenceSignature(body.draft);
        if (nextSignature === cartEvidenceRef.current) return;
        cartEvidenceRef.current = nextSignature;
        setDraft(body.draft);
        setNotice("1688 장바구니에서 확인한 실제 위안단가와 중국 내 운임을 자동 반영했습니다.");
        router.refresh();
      } finally {
        refreshing = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCartEvidence();
    };
    const timer = window.setInterval(() => void refreshCartEvidence(), 5_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [initialDraft.draftId, router]);

  useEffect(() => {
    const tableScroll = tableScrollRef.current;
    const topScroll = topScrollRef.current;
    if (!tableScroll || !topScroll) return;

    const measure = () => {
      const table = tableScroll.querySelector("table");
      setScrollWidth(Math.max(table?.scrollWidth ?? TABLE_WIDTH, tableScroll.clientWidth));
    };
    const syncFromTop = () => {
      if (tableScroll.scrollLeft !== topScroll.scrollLeft) tableScroll.scrollLeft = topScroll.scrollLeft;
    };
    const syncFromTable = () => {
      if (topScroll.scrollLeft !== tableScroll.scrollLeft) topScroll.scrollLeft = tableScroll.scrollLeft;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tableScroll);
    const table = tableScroll.querySelector("table");
    if (table) observer.observe(table);
    topScroll.addEventListener("scroll", syncFromTop, { passive: true });
    tableScroll.addEventListener("scroll", syncFromTable, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      topScroll.removeEventListener("scroll", syncFromTop);
      tableScroll.removeEventListener("scroll", syncFromTable);
      window.removeEventListener("resize", measure);
    };
  }, [draft.lines.length]);

  const freightGroups = useMemo(() => {
    const groups = new Map<string, FreightGroupInfo>();
    for (const line of draft.lines) {
      const groupId = line.freightGroupId.trim();
      if (!groupId) continue;
      const key = lineKey(line);
      const current = groups.get(key) ?? {
        key,
        members: [],
        leaderBarcode: line.barcode,
        totalFreight: 0,
      };
      current.members.push(line);
      current.totalFreight += decimal(line.domesticChinaFreightCny);
      groups.set(key, current);
    }
    return groups;
  }, [draft.lines]);

  const supplierLinkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of draft.lines) {
      const key = supplierPageKey(line.supplierLink);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [draft.lines]);

  const calculations = useMemo(() => {
    const groups = new Map<string, { quantity: number; freight: number }>();
    for (const line of draft.lines) {
      const key = lineKey(line);
      const current = groups.get(key) ?? { quantity: 0, freight: 0 };
      current.quantity += line.quantity;
      current.freight += decimal(line.domesticChinaFreightCny);
      groups.set(key, current);
    }

    const byBarcode = new Map<
      string,
      {
        freightPerUnitCny: number;
        finalUnitCny: number;
        actualUnitKrw: number;
        internalStandardUnitKrw: number;
      }
    >();
    let productCny = 0;
    let totalKrw = 0;
    let internalStandardTotalKrw = 0;

    for (const line of draft.lines) {
      const group = groups.get(lineKey(line)) ?? { quantity: 0, freight: 0 };
      const freightPerUnitCny = group.quantity > 0 ? group.freight / group.quantity : 0;
      const finalUnitCny = decimal(line.unitPriceCny) + freightPerUnitCny;
      const actualUnitKrw = finalUnitCny * draft.exchangeRateKrwPerCny;
      const rowTotalKrw = actualUnitKrw * line.quantity;
      const internalStandardUnitKrw = actualUnitKrw * draft.internalOrderCostMultiplier;
      byBarcode.set(line.barcode, {
        freightPerUnitCny,
        finalUnitCny,
        actualUnitKrw,
        internalStandardUnitKrw,
      });
      productCny += decimal(line.unitPriceCny) * line.quantity;
      totalKrw += rowTotalKrw;
      internalStandardTotalKrw += rowTotalKrw * draft.internalOrderCostMultiplier;
    }
    const freightCny = [...groups.values()].reduce((sum, group) => sum + group.freight, 0);
    const productKrw = productCny * draft.exchangeRateKrwPerCny;
    const budgetKrw = budgetAudit.productOrderBudgetKrw;
    const budgetUsedPercent =
      budgetKrw > 0 ? Math.round((productKrw / budgetKrw) * 10_000) / 100 : 0;
    return {
      byBarcode,
      productCny,
      productKrw,
      freightCny,
      totalKrw,
      internalStandardTotalKrw,
      budgetUsedPercent,
      budgetRemainingKrw: Math.max(0, budgetKrw - productKrw),
      budgetOverKrw: Math.max(0, productKrw - budgetKrw),
      actualPriceCount: draft.lines.filter((line) => decimal(line.unitPriceCny) > 0).length,
    };
  }, [budgetAudit.productOrderBudgetKrw, draft]);

  const requiredIssues = useMemo(
    () => internalChinaOrderEvidenceIssues(draft.lines),
    [draft.lines],
  );

  const optionReviewCount = useMemo(
    () => draft.lines.filter((line) => !line.chinaOption.trim()).length,
    [draft.lines],
  );

  const preparationExcludedLines = useMemo(
    () => draft.lines.filter((line) => line.note.includes(PREPARATION_NOTE_PREFIX)),
    [draft.lines],
  );

  function updateLine(barcode: string, patch: Partial<InternalChinaPurchaseDraftLine>) {
    if (draft.status !== "DRAFT") return;
    cartRefreshDeadlineRef.current = 0;
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.barcode === barcode ? { ...line, ...patch } : line,
      ),
    }));
  }

  function stageQuantity(barcode: string, targetQuantity: number) {
    const baseline = draft.lines.find((line) => line.barcode === barcode)?.quantity;
    if (baseline === undefined) return;
    const valid = isPurchaseDraftQuantityUnit(targetQuantity);
    setEditedQuantities((current) => {
      const next = { ...current };
      if (valid && targetQuantity === baseline) delete next[barcode];
      else next[barcode] = targetQuantity;
      return next;
    });
    setNotice(
      !valid
        ? `${barcode} 수량을 5개 단위로 입력하세요. 입력 범위는 5~9,995개입니다.`
        : targetQuantity === baseline
        ? `${barcode} 수량 변경을 취소했습니다.`
        : `${barcode} ${targetQuantity.toLocaleString("ko-KR")}개를 재계산 대기에 넣었습니다. 아직 기존 Draft는 바뀌지 않았습니다.`,
    );
  }

  function updateModelSupplierLink(
    source: Pick<InternalChinaPurchaseDraftLine, "modelNo" | "barcode">,
    supplierLink: string,
  ) {
    if (draft.status !== "DRAFT") return;
    const target = modelKey(source);
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        modelKey(line) === target ? { ...line, supplierLink } : line,
      ),
    }));
  }

  function updateGroupFreight(groupKey: string, value: number) {
    if (draft.status !== "DRAFT") return;
    const info = freightGroups.get(groupKey);
    if (!info) return;
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (lineKey(line) !== groupKey) return line;
        return {
          ...line,
          domesticChinaFreightCny: line.barcode === info.leaderBarcode ? value : 0,
        };
      }),
    }));
  }

  function autoGroupSameSupplierLinks() {
    if (draft.status !== "DRAFT") return;
    const groups = new Map<string, InternalChinaPurchaseDraftLine[]>();
    for (const line of draft.lines) {
      const key = supplierPageKey(line.supplierLink);
      if (!key) continue;
      const members = groups.get(key) ?? [];
      members.push(line);
      groups.set(key, members);
    }
    const eligible = [...groups.entries()].filter(([, members]) => members.length > 1);
    if (!eligible.length) {
      setNotice("같은 1688 상품페이지를 사용하는 복수 SKU가 없습니다.");
      return;
    }
    const updates = new Map<string, { groupId: string; leader: string; totalFreight: number }>();
    for (const [key, members] of eligible) {
      const groupId = `LINK-${key.replace(/[^A-Za-z0-9-]/g, "").slice(-40)}`;
      const totalFreight = members.reduce(
        (sum, member) => sum + decimal(member.domesticChinaFreightCny),
        0,
      );
      for (const member of members) {
        updates.set(member.barcode, {
          groupId,
          leader: members[0].barcode,
          totalFreight,
        });
      }
    }
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        const update = updates.get(line.barcode);
        if (!update) return line;
        return {
          ...line,
          freightGroupId: update.groupId,
          domesticChinaFreightCny:
            line.barcode === update.leader ? update.totalFreight : 0,
        };
      }),
    }));
    const skuCount = eligible.reduce((sum, [, members]) => sum + members.length, 0);
    setNotice(
      `같은 1688 링크 기준 ${eligible.length}개 합배송 그룹 · ${skuCount} SKU를 묶었습니다. 각 그룹 첫 행의 '그룹 총운임'만 입력하고 우측 입력값 저장(Ctrl+S)으로 확정하세요.`,
    );
  }

  function payload(sourceDraft = draft) {
    return {
      lines: sourceDraft.lines.map((line) => ({
        barcode: line.barcode,
        modelNo: line.modelNo,
        quantity: line.quantity,
        chinaOption: line.chinaOption,
        supplierLink: line.supplierLink,
        unitPriceCny: line.unitPriceCny,
        freightGroupId: line.freightGroupId,
        domesticChinaFreightCny: line.domesticChinaFreightCny,
        orderNumber: line.orderNumber,
        note: line.note,
      })),
    };
  }

  async function persistDraft(
    options: { quiet?: boolean; syncMetadata?: boolean; refresh?: boolean } = {},
  ) {
    const response = await fetch(
      `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload()),
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    const body = (await response.json().catch(() => ({}))) as DraftSaveResponse;
    if (!response.ok || !body.ok || !body.draft) {
      throw new Error(body.message || "중국 발주초안 저장에 실패했습니다.");
    }

    let nextDraft = body.draft;
    let metadataMessage = "";
    if (options.syncMetadata !== false) {
      try {
        const metadataResponse = await fetch(
          `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}/purchase-metadata`,
          {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(payload(nextDraft)),
            credentials: "same-origin",
            cache: "no-store",
          },
        );
        const metadata = (await metadataResponse.json().catch(() => ({}))) as MetadataSyncResponse;
        if (!metadataResponse.ok || !metadata.ok) {
          throw new Error(
            metadata.message || "Draft는 저장됐지만 상품출시진행관리 역저장을 완료하지 못했습니다.",
          );
        }
        if (metadata.draft) nextDraft = metadata.draft;
        const warnings = metadata.warnings?.filter(Boolean) ?? [];
        metadataMessage = metadata.productMasterSynced
          ? `상품출시진행관리와 상품마스터 최신 원장에 양방향 반영했습니다. 모델 ${metadata.syncedModels ?? 0}개 · B-code ${metadata.syncedBcodes ?? 0}개.`
          : `상품출시진행관리에는 반영했지만 상품마스터 동기화 확인이 필요합니다: ${metadata.productMasterError || warnings.join(" · ") || "재시도 필요"}`;
      } catch (error) {
        metadataMessage =
          error instanceof Error
            ? `Draft는 저장됐지만 구매정보 역저장은 확인이 필요합니다: ${error.message}`
            : "Draft는 저장됐지만 구매정보 역저장은 확인이 필요합니다.";
      }
    }

    setDraft(nextDraft);
    if (!options.quiet) setNotice(`발주초안을 저장했습니다. ${metadataMessage}`);
    if (options.refresh !== false) router.refresh();
    return nextDraft;
  }

  async function saveDraft() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    setSaving(true);
    try {
      await persistDraft();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "중국 발주초안 저장 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedBarcodes = draft.lines
    .filter((line) => selectedRows[line.barcode] === true)
    .map((line) => line.barcode)
    .sort();
  const excludedBarcodes = draft.lines
    .filter((line) => stagedExclusions[line.barcode] === true)
    .map((line) => line.barcode)
    .sort();
  const allLinesSelected = draft.lines.length > 0 && selectedBarcodes.length === draft.lines.length;
  const selectedExclusionCandidates = selectedBarcodes.filter(
    (barcode) => stagedExclusions[barcode] !== true,
  );
  const changedQuantityRows = Object.entries(editedQuantities)
    .map(([barcode, targetQuantity]) => ({ barcode, targetQuantity }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
  const invalidQuantityBarcodes = changedQuantityRows
    .filter((row) => !isPurchaseDraftQuantityUnit(row.targetQuantity))
    .map((row) => row.barcode);
  const activeQuantityOverrides = Object.entries({
    ...persistedQuantityOverrides,
    ...editedQuantities,
    ...Object.fromEntries(
      stagedAdditions.map((row) => [row.barcode, row.targetQuantity]),
    ),
  })
    .filter(([barcode]) => !excludedBarcodes.includes(barcode))
    .map(([barcode, targetQuantity]) => ({
      barcode,
      targetQuantity: nearestPurchaseDraftQuantity(targetQuantity),
    }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
  const quantitiesNeedingUnitRounding = draft.lines.filter((line) => {
    if (selectedRows[line.barcode] !== true || stagedExclusions[line.barcode] === true) return false;
    const candidate = Object.hasOwn(editedQuantities, line.barcode)
      ? editedQuantities[line.barcode]
      : line.quantity;
    return nearestPurchaseDraftQuantity(candidate) !== candidate;
  });
  const hasPendingRecalculation =
    excludedBarcodes.length > 0 ||
    changedQuantityRows.length > 0 ||
    stagedAdditions.length > 0;

  function toggleSelectedBarcode(barcode: string, checked: boolean) {
    setSelectedRows((current) => ({ ...current, [barcode]: checked }));
  }

  function stageSelectedQuantitiesToNearestUnit() {
    if (draft.status !== "DRAFT" || quantitiesNeedingUnitRounding.length === 0) return;
    const roundedCount = quantitiesNeedingUnitRounding.length;
    setEditedQuantities((current) => {
      const next = { ...current };
      for (const line of quantitiesNeedingUnitRounding) {
        const candidate = Object.hasOwn(current, line.barcode)
          ? current[line.barcode]
          : line.quantity;
        const rounded = nearestPurchaseDraftQuantity(candidate);
        if (rounded <= 0) continue;
        if (rounded === line.quantity) delete next[line.barcode];
        else next[line.barcode] = rounded;
      }
      return next;
    });
    setNotice(
      `선택한 상품 중 ${roundedCount.toLocaleString("ko-KR")}종의 수량을 가장 가까운 5개 단위로 맞췄습니다. 끝자리는 0 또는 5가 되며, 아직 기존 Draft는 바뀌지 않았습니다.`,
    );
  }

  function stageSelectedProductsForExclusion() {
    if (draft.status !== "DRAFT" || selectedBarcodes.length === 0) return;
    const newlyExcludedBarcodes = selectedExclusionCandidates;
    if (newlyExcludedBarcodes.length === 0) {
      setNotice("선택한 상품은 이미 모두 제외 대기 중입니다.");
      return;
    }
    setStagedExclusions((current) => ({
      ...current,
      ...Object.fromEntries(newlyExcludedBarcodes.map((barcode) => [barcode, true])),
    }));
    setEditedQuantities((current) => {
      const next = { ...current };
      for (const barcode of newlyExcludedBarcodes) delete next[barcode];
      return next;
    });
    setSelectedRows({});
    setNotice(
      `선택한 ${newlyExcludedBarcodes.length.toLocaleString("ko-KR")}종을 초안 제외 대기에 넣었습니다. 아직 기존 Draft는 바뀌지 않았습니다.`,
    );
  }

  async function recalculateDraft() {
    if (
      draft.status !== "DRAFT" ||
      regenerating ||
      !hasPendingRecalculation ||
      invalidQuantityBarcodes.length > 0
    ) return;
    setRegenerating(true);
    setNotice("현재 Draft에서 최신 우선순위와 예산을 다시 계산하고 있습니다. 다른 준비 화면으로 이동하지 않습니다.");
    try {
      const settings = new URL(regenerationHref, window.location.origin);
      const cash = settings.searchParams.get("cash");
      const response = await fetch("/api/purchase-cycle/preflight-draft/recalculate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          targetDate: settings.searchParams.get("date"),
          cashLimitKrw: cash ? Number(cash) : null,
          sourcingBudgetPercent: Number(settings.searchParams.get("sourcing") || 0),
          allowOpenBudgetPreview: settings.searchParams.get("early") === "1",
          replaceDraftId: draft.draftId,
          excludedBarcodes,
          quantityOverrides: activeQuantityOverrides,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as DraftRecalculationResponse;
      if (!response.ok || !body.ok || !body.draft?.draftId) {
        throw new Error(body.message || `발주안 재계산 실패 · ${body.code || response.status}`);
      }
      setEditedQuantities({});
      setSelectedRows({});
      setStagedExclusions({});
      onStagedAdditionsChange([]);
      const successMessage = body.message || "변경사항을 반영해 발주안을 다시 계산했습니다.";
      setNotice(successMessage);
      const destination = new URL(
        `/china-order-manager/drafts/${encodeURIComponent(body.draft.draftId)}`,
        window.location.origin,
      );
      destination.searchParams.set("recalculationNotice", successMessage);
      router.replace(`${destination.pathname}${destination.search}`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "발주안 재계산 요청이 실패했습니다. 현재 Draft는 그대로 유지했습니다.");
      setRegenerating(false);
    }
  }

  function resetPendingRecalculation() {
    setEditedQuantities({});
    setSelectedRows({});
    setStagedExclusions({});
    onStagedAdditionsChange([]);
    setNotice("재계산 대기 변경을 모두 취소했습니다. 기존 Draft는 바뀌지 않았습니다.");
  }

  async function prepare1688Cart() {
    if (draft.status !== "DRAFT" || saving || cartPreparing) return;
    const localAgent = window.open("about:blank", "commerce-os-1688-cart");
    if (!localAgent) {
      setNotice("팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.");
      return;
    }
    setCartPreparing(true);
    setNotice("현재 입력값을 저장한 뒤 이 초안을 로컬 1688 자동화로 엽니다.");
    try {
      const savedDraft = await persistDraft({ quiet: true, syncMetadata: false });
      cartEvidenceRef.current = purchaseEvidenceSignature(savedDraft);
      cartRefreshDeadlineRef.current = Date.now() + 30 * 60_000;
      localAgent.location.href = `http://127.0.0.1:43121/?draftId=${encodeURIComponent(savedDraft.draftId)}`;
      setNotice("로컬 업무센터가 열렸습니다. 5번 ‘1688 장바구니 준비’를 실행하면 중국옵션·수량을 맞추고 장바구니/결제 직전의 실제 위안단가와 판매자별 중국내 운임을 저장하며, 이 화면의 합계도 자동 갱신됩니다.");
    } catch (error) {
      localAgent.close();
      setNotice(error instanceof Error ? error.message : "1688 장바구니 준비를 시작하지 못했습니다.");
    } finally {
      setCartPreparing(false);
    }
  }

  async function markOrdered() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    if (requiredIssues.length) {
      setNotice(
        `실제 주문완료 기록 전에 필수값 ${requiredIssues.length}개를 채우세요. ${requiredIssues
          .slice(0, 6)
          .join(" · ")}`,
      );
      return;
    }
    if (
      !window.confirm(
        `실제로 1688에서 ${draft.lineCount}개 SKU · 총 ${draft.totalQuantity.toLocaleString("ko-KR")}개 주문을 완료했습니까?\n\n이 버튼은 1688 주문·결제를 실행하지 않습니다. 실제 주문이 끝난 뒤에만 Ops Center 원장을 ORDERED로 기록합니다.`,
      )
    ) {
      return;
    }
    setOrdering(true);
    try {
      const savedDraft = await persistDraft({ quiet: true });
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ action: "MARK_ORDERED", prep: payload(savedDraft) }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as DraftSaveResponse;
      if (!response.ok || !body.ok || !body.draft) {
        throw new Error(body.message || "실제 주문완료 기록에 실패했습니다.");
      }
      setDraft(body.draft);
      setNotice(body.message || "실제 주문완료로 원장에 기록했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "실제 주문완료 기록 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setOrdering(false);
    }
  }

  function scrollTable(direction: -1 | 1) {
    const target = tableScrollRef.current;
    if (!target) return;
    target.scrollBy({
      left: direction * Math.max(360, Math.round(target.clientWidth * 0.78)),
      behavior: "smooth",
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={draft.status === "ORDERED" ? "실주문 기록" : "주문 준비"} />
        <Metric label="SKU" value={`${number.format(draft.lineCount)}개`} />
        <Metric label="총 주문수량" value={`${number.format(draft.totalQuantity)}개`} />
        <Metric label="필수 확인" value={`${number.format(requiredIssues.length)}건`} danger={requiredIssues.length > 0} />
        <Metric label="내부기준원가" value={`${number.format(Math.round(calculations.internalStandardTotalKrw))}원`} emphasized />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">OPS CENTER NATIVE · BIDIRECTIONAL</span>
            <h2 className="mt-1 text-xl font-black text-slate-950">실제 1688 주문 준비</h2>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
              링크·중국옵션을 확인한 뒤 `1688 장바구니 준비`를 실행하면 권장수량을 정확히 맞추고 장바구니 이후 실제 단가와 판매자별 중국내 운임을 이 표에 기록합니다. 주문 제출과 결제는 자동 실행하지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[230px] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <span className="block text-xs font-bold text-emerald-700">내부기준원가</span>
              <strong className="mt-0.5 block text-right text-base font-black text-emerald-950">
                {number.format(Math.round(calculations.internalStandardTotalKrw))}원
              </strong>
              <span className="mt-0.5 block text-[11px] text-emerald-700">실주문 원가 × 내부 주문 수수료율 {draft.internalOrderCostMultiplier.toFixed(2)}</span>
            </div>
            <a href="https://commerce-os-product-master.vercel.app/purchase-metadata" target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">상품마스터 최신 원장</a>
            <button type="button" onClick={() => void prepare1688Cart()} disabled={cartPreparing || saving || draft.status !== "DRAFT" || !draft.lines.length} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-black text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">{cartPreparing ? "로컬 자동화 여는 중..." : "1688 장바구니 준비"}</button>
            <button type="button" onClick={() => void saveDraft()} disabled={saving || draft.status !== "DRAFT"} className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "양방향 저장 중..." : "발주초안 저장"}</button>
            <button type="button" onClick={() => void markOrdered()} disabled={ordering || draft.status !== "DRAFT" || requiredIssues.length > 0} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">{draft.status === "ORDERED" ? "실주문 기록완료" : ordering ? "기록 중..." : "1688 주문완료 후 기록"}</button>
          </div>
        </div>

        {notice ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">{notice}</div> : null}
        {draft.metadataWarnings.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">{draft.metadataWarnings.slice(0, 4).join(" · ")}</div> : null}
        {preparationExcludedLines.length ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-950">
            <strong>1688 장바구니 준비 제외 {number.format(preparationExcludedLines.length)} SKU</strong>
            <span className="ml-2">{preparationExcludedLines.slice(0, 10).map((line) => `${line.barcode} ${line.note.split(PREPARATION_NOTE_PREFIX)[1]?.trim() || "처리 불가"}`).join(" · ")}</span>
            {preparationExcludedLines.length > 10 ? ` · 외 ${number.format(preparationExcludedLines.length - 10)}건` : ""}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SubMetric label="상품금액" value={`${cny.format(calculations.productCny)} CNY`} />
          <SubMetric label="중국내 운임" value={`${cny.format(calculations.freightCny)} CNY`} />
          <SubMetric label="실주문 원가" value={`${number.format(Math.round(calculations.totalKrw))}원`} />
          <SubMetric label="중국옵션 확인 필요" value={`${number.format(optionReviewCount)} SKU`} />
        </div>

        <div className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-5 ${calculations.budgetOverKrw > 0 ? "border-rose-300 bg-rose-50 text-rose-950" : "border-blue-200 bg-blue-50 text-blue-950"}`}>
          <strong>실시간 월간 발주예산 검증</strong> · 실제 위안단가 입력 완료 {calculations.actualPriceCount}/{draft.lineCount} SKU · 현재 입력 상품대금 {number.format(Math.round(calculations.productKrw))}원 · 상품대금 한도 {number.format(budgetAudit.productOrderBudgetKrw)}원 · 사용률 {calculations.budgetUsedPercent.toLocaleString("ko-KR")}% · {calculations.budgetOverKrw > 0 ? `초과 ${number.format(Math.round(calculations.budgetOverKrw))}원` : `잔여 ${number.format(Math.round(calculations.budgetRemainingKrw))}원`}.
        </div>
        <div className={`mt-4 rounded-xl border px-4 py-4 ${hasPendingRecalculation ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong className="text-sm font-black text-slate-950">한 번에 발주안 재계산</strong>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-700">
                작업 선택 {selectedBarcodes.length}종 · 수량 변경 {changedQuantityRows.length}종 · 제외 {excludedBarcodes.length}종 · 추가 {stagedAdditions.length}종입니다. 체크만으로는 삭제되지 않으며, 재계산 버튼을 누르기 전에는 기존 Draft와 주문·입고 원장이 바뀌지 않습니다.
              </p>
              {invalidQuantityBarcodes.length > 0 ? (
                <p className="mt-1 text-xs font-black text-rose-700">
                  수량을 다시 입력할 상품: {invalidQuantityBarcodes.join(" · ")}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                이 화면에서 바로 새 Draft로 교체합니다. 자동 권장수량은 5개 단위로 맞추고 10개 단위를 우선하며, 남은 예산은 다음 우선순위에 배정합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={stageSelectedQuantitiesToNearestUnit} disabled={draft.status !== "DRAFT" || quantitiesNeedingUnitRounding.length === 0 || regenerating} className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">
                선택 수량 5·10단위 맞춤 ({quantitiesNeedingUnitRounding.length}종)
              </button>
              <button type="button" onClick={stageSelectedProductsForExclusion} disabled={draft.status !== "DRAFT" || selectedExclusionCandidates.length === 0 || regenerating} className="min-h-11 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-black text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40">
                선택 상품 초안에서 제외 ({selectedExclusionCandidates.length}종)
              </button>
              <button type="button" onClick={() => setSelectedRows({})} disabled={selectedBarcodes.length === 0 || regenerating} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                선택 해제
              </button>
              <button type="button" onClick={resetPendingRecalculation} disabled={!hasPendingRecalculation || regenerating} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                대기 변경 취소
              </button>
              <button type="button" onClick={recalculateDraft} disabled={draft.status !== "DRAFT" || !hasPendingRecalculation || invalidQuantityBarcodes.length > 0 || regenerating} aria-busy={regenerating} className="min-h-11 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
                {regenerating ? "현재 화면에서 재계산 중..." : "변경사항 모아 발주안 바로 재계산"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="sticky top-0 z-40 rounded-t-2xl border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => scrollTable(-1)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">← 왼쪽</button>
            <div ref={topScrollRef} className="h-4 min-w-[220px] flex-1 overflow-x-auto overflow-y-hidden rounded bg-slate-100" aria-label="표 좌우 스크롤"><div style={{ width: scrollWidth, height: 1 }} /></div>
            <button type="button" onClick={() => scrollTable(1)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">오른쪽 →</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
              고정할 마지막 열
              <select value={freezeThrough} onChange={(event) => setFreezeThrough(Number(event.target.value))} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-900">
                <option value={-1}>고정 안 함</option>
                {TABLE_COLUMNS.map((column, index) => (
                  <option key={column.label} value={index}>{column.label}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={autoGroupSameSupplierLinks} disabled={draft.status !== "DRAFT"} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">같은 1688 링크 자동 합배송</button>
            <span className="text-[11px] font-semibold text-slate-500">선택한 열까지 왼쪽에 고정됩니다. 합배송은 그룹 첫 행의 총운임 1회 입력으로 수량 비율 배분합니다.</span>
          </div>
        </div>

        <div ref={tableScrollRef} className="overflow-x-auto overscroll-x-contain">
          <table className="table-fixed text-left text-xs" style={{ minWidth: TABLE_WIDTH, width: TABLE_WIDTH }}>
            <colgroup>
              {TABLE_COLUMNS.map((column) => <col key={column.label} style={{ width: column.width }} />)}
            </colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
              <tr>
                {TABLE_COLUMNS.map((column, index) => (
                  <th key={column.label} className={`px-3 py-3 ${index >= 3 && index <= 10 ? "text-right" : ""}`} style={stickyCellStyle(index, freezeThrough, true)}>
                    {index === 0 ? <div><label className="flex items-center gap-2"><input type="checkbox" checked={allLinesSelected} onChange={(event) => setSelectedRows(Object.fromEntries(draft.lines.map((line) => [line.barcode, event.target.checked])))} disabled={draft.status !== "DRAFT"} aria-label="작업할 상품 전체 선택" className="size-4" /><span>작업할 상품 선택</span></label><span className="mt-1 block text-[11px] font-semibold text-slate-500">{column.label}</span></div> : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.lines.map((line) => {
                const calc = calculations.byBarcode.get(line.barcode)!;
                const editable = draft.status === "DRAFT";
                const linkValid = validHttpUrl(line.supplierLink);
                const groupInfo = line.freightGroupId.trim() ? freightGroups.get(lineKey(line)) : undefined;
                const sharedGroup = Boolean(groupInfo && groupInfo.members.length > 1);
                const groupLeader = Boolean(sharedGroup && groupInfo?.leaderBarcode === line.barcode);
                const sameLinkCount = supplierLinkCounts.get(supplierPageKey(line.supplierLink)) ?? 0;
                return (
                  <tr key={line.barcode} className={`align-top hover:bg-slate-50/70 ${stagedExclusions[line.barcode] === true ? "bg-rose-50/70" : ""}`}>
                    <td className="px-3 py-3" style={stickyCellStyle(0, freezeThrough)}>
                      <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={selectedRows[line.barcode] === true} onChange={(event) => toggleSelectedBarcode(line.barcode, event.target.checked)} disabled={!editable} aria-label={`${line.barcode} 작업할 상품 선택`} className="size-4" /><strong className="font-mono text-sm text-slate-950">{line.barcode}</strong>{stagedExclusions[line.barcode] === true ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">제외 대기</span> : null}</label>
                      <span className="mt-1 block font-semibold text-slate-700">{line.modelName || "모델명 -"}</span>
                      <span className="mt-1 block font-mono text-[11px] text-slate-400">{line.modelNo}</span>
                      <span className="mt-2 inline-flex rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-800">옵션 · {line.saleOption || "-"}</span>
                      {line.note.includes(PREPARATION_NOTE_PREFIX) ? <span className="mt-2 block rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black leading-4 text-rose-800">{line.note.split(PREPARATION_NOTE_PREFIX)[1]?.split(" · ")[0]?.trim() || "1688 장바구니 준비 제외"}</span> : null}
                    </td>
                    <td className="px-2 py-2" style={stickyCellStyle(1, freezeThrough)}>
                      <div className="flex items-center gap-1.5">
                        <Input value={line.chinaOption} disabled={!editable} required={!line.chinaOption.trim()} placeholder="1688 실제 중국옵션명" onChange={(value) => updateLine(line.barcode, { chinaOption: value })} />
                        <button type="button" disabled={!editable} onClick={() => updateLine(line.barcode, { chinaOption: "단품" })} className={`shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-black disabled:opacity-40 ${line.chinaOption.trim() === "단품" ? "border-blue-600 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>단품</button>
                      </div>
                      <span className="mt-1 block text-[10px] font-bold text-indigo-700">옵션 없음은 `단품` · 저장 시 해당 B-code로 상품출시·상품마스터에 역저장</span>
                    </td>
                    <td className="px-2 py-2" style={stickyCellStyle(2, freezeThrough)}>
                      <div className="flex items-center gap-2">
                        <Input value={line.supplierLink} type="url" disabled={!editable} required={!linkValid} placeholder="https://detail.1688.com/offer/..." onChange={(value) => updateModelSupplierLink(line, value)} mono />
                        {linkValid ? <a href={line.supplierLink} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-2 font-black text-emerald-800 hover:bg-emerald-50">1688 열기</a> : null}
                      </div>
                      <span className="mt-1 block text-[10px] font-bold text-indigo-700">같은 모델 모든 B-code에 공통 적용 · 저장 시 상품출시 1번 링크로 역저장</span>
                    </td>
                    <td className="px-2 py-2 text-right" style={stickyCellStyle(3, freezeThrough)}>
                      <NativeQuantityControl key={`${line.barcode}:${editedQuantities[line.barcode] ?? line.quantity}`} status={draft.status} barcode={line.barcode} quantity={line.quantity} stagedQuantity={editedQuantities[line.barcode]} onStage={stageQuantity} />
                    </td>
                    <td className="px-2 py-2" style={stickyCellStyle(4, freezeThrough)}><NumberInput value={line.unitPriceCny} disabled={!editable} required={line.unitPriceCny <= 0} onChange={(value) => updateLine(line.barcode, { unitPriceCny: value })} /></td>
                    <td className="px-2 py-2" style={stickyCellStyle(5, freezeThrough)}>
                      <Input value={line.freightGroupId} disabled={!editable} placeholder="합배송 그룹" onChange={(value) => updateLine(line.barcode, { freightGroupId: value })} />
                      {sharedGroup ? <span className="mt-1 block text-[10px] font-black text-emerald-700">합배송 {groupInfo?.members.length} SKU</span> : sameLinkCount > 1 ? <span className="mt-1 block text-[10px] font-bold text-amber-700">동일 1688 링크 {sameLinkCount} SKU · 자동묶기 가능</span> : null}
                    </td>
                    <td className="px-2 py-2" style={stickyCellStyle(6, freezeThrough)}>
                      {sharedGroup && !groupLeader ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-right text-[10px] font-bold text-emerald-800">그룹 공유<br/><span className="font-normal">총운임은 {groupInfo?.leaderBarcode}</span></div>
                      ) : (
                        <div>
                          <NumberInput value={sharedGroup ? groupInfo?.totalFreight ?? 0 : line.domesticChinaFreightCny} disabled={!editable} showZero onChange={(value) => sharedGroup ? updateGroupFreight(lineKey(line), value) : updateLine(line.barcode, { domesticChinaFreightCny: value })} />
                          <span className="mt-1 block text-right text-[10px] font-bold text-slate-500">{sharedGroup ? `그룹 총운임 · ${groupInfo?.members.length} SKU` : "개별 운임 · 무료배송은 0"}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-600" style={stickyCellStyle(7, freezeThrough)}>{cny.format(calc.freightPerUnitCny)}</td>
                    <td className="px-3 py-3 text-right font-black text-emerald-800" style={stickyCellStyle(8, freezeThrough)}>{cny.format(calc.finalUnitCny)}</td>
                    <td className="px-3 py-3 text-right font-black text-blue-800" style={stickyCellStyle(9, freezeThrough)}>{number.format(Math.round(calc.actualUnitKrw))}원</td>
                    <td className="px-3 py-3 text-right font-black text-violet-800" style={stickyCellStyle(10, freezeThrough)}>{number.format(Math.round(calc.internalStandardUnitKrw))}원</td>
                    <td className="px-2 py-2" style={stickyCellStyle(11, freezeThrough)}><Input value={line.orderNumber} disabled={!editable} placeholder="1688 주문번호" onChange={(value) => updateLine(line.barcode, { orderNumber: value })} /></td>
                    <td className="px-2 py-2" style={stickyCellStyle(12, freezeThrough)}><Input value={line.note} disabled={!editable} placeholder="주문·옵션 특이사항" onChange={(value) => updateLine(line.barcode, { note: value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NativeQuantityControl({
  status,
  barcode,
  quantity,
  stagedQuantity,
  onStage,
}: {
  status: "DRAFT" | "ORDERED";
  barcode: string;
  quantity: number;
  stagedQuantity?: number;
  onStage: (barcode: string, quantity: number) => void;
}) {
  const [value, setValue] = useState(String(stagedQuantity ?? quantity));
  const targetQuantity = Math.round(Number(value));
  const valid = isPurchaseDraftQuantityUnit(targetQuantity);
  const changed = valid && targetQuantity !== quantity;
  const currentNeedsRounding = stagedQuantity === undefined && quantity % 5 !== 0;

  function updateValue(nextValue: string) {
    setValue(nextValue);
    const parsed = Math.round(Number(nextValue));
    if (Number.isFinite(parsed) && parsed >= 5 && parsed <= 9_995 && parsed % 5 === 0) {
      onStage(barcode, parsed);
    } else {
      onStage(barcode, Number.isFinite(parsed) ? parsed : 0);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5" data-native-draft-quantity={barcode}>
      <input type="number" min={5} max={9995} step={5} value={value} disabled={status !== "DRAFT"} onChange={(event) => updateValue(event.target.value)} aria-label={`${barcode} 주문수량`} aria-invalid={!valid} className={`w-20 rounded-lg border bg-white px-2 py-2 text-right text-xs font-black outline-none disabled:bg-slate-100 ${!valid ? "border-rose-400 text-rose-800" : changed ? "border-blue-400 text-blue-900" : "border-slate-300 text-slate-800"}`} />
      <span className={`max-w-[74px] truncate text-[10px] font-bold ${!valid ? "text-rose-700" : changed ? "text-blue-700" : "text-slate-400"}`}>
        {!valid ? "5개 단위" : changed ? "재계산 대기" : currentNeedsRounding ? "재계산 시 정리" : "현재 수량"}
      </span>
    </div>
  );
}

function Metric({ label, value, emphasized = false, danger = false }: { label: string; value: string; emphasized?: boolean; danger?: boolean }) {
  return <article className={`rounded-xl border px-4 py-3 ${emphasized ? "border-blue-300 bg-blue-50" : danger ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}><span className="block text-xs font-bold text-slate-500">{label}</span><strong className={`mt-1 block text-xl font-black ${danger ? "text-rose-700" : emphasized ? "text-blue-800" : "text-slate-950"}`}>{value}</strong></article>;
}

function SubMetric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><span className="block text-xs font-bold text-slate-500">{label}</span><strong className="mt-1 block text-lg font-black text-slate-950">{value}</strong></article>;
}

function Input({ value, onChange, disabled = false, required = false, placeholder = "", type = "text", mono = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean; placeholder?: string; type?: "text" | "url"; mono?: boolean }) {
  return <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`w-full rounded-lg border px-3 py-2 outline-none disabled:bg-slate-100 ${mono ? "font-mono text-[11px]" : "text-xs"} ${required ? "border-amber-400 bg-amber-50 focus:border-amber-600" : "border-slate-300 bg-white focus:border-blue-500"}`} />;
}

function NumberInput({ value, onChange, disabled = false, required = false, showZero = false }: { value: number; onChange: (value: number) => void; disabled?: boolean; required?: boolean; showZero?: boolean }) {
  return <input type="number" min="0" step="0.01" inputMode="decimal" value={showZero ? value : value || ""} disabled={disabled} onChange={(event) => onChange(cnyCent(event.target.value))} className={`w-28 rounded-lg border px-3 py-2 text-right text-xs font-bold outline-none disabled:bg-slate-100 ${required ? "border-amber-400 bg-amber-50 focus:border-amber-600" : "border-slate-300 bg-white focus:border-blue-500"}`} />;
}
