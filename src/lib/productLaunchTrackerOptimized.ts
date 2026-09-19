export const PRODUCT_LAUNCH_DEFAULT_PAGE_SIZE = 50;
export const PRODUCT_LAUNCH_MAX_PAGE_SIZE = 100;
export const PRODUCT_LAUNCH_MUTATION_LIMIT = 500;

const STAGES = [
  { key: "detailPage", label: "상세페이지" },
  { key: "priceKeyword", label: "가격·키워드" },
  { key: "shoplingUpload", label: "샵플링 업로드" },
  { key: "marketRegistration", label: "마켓 등록" },
  { key: "orderMapping", label: "주문 매핑" },
  { key: "inventoryReflection", label: "재고 반영" },
] as const;

const STATUS_OPTIONS = new Set(["미시작", "진행 중", "완료", "보류", "제외"]);
const COMPLETE_STATUSES = new Set(["완료", "제외"]);

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchTrackerState = UnknownRecord & {
  items?: unknown;
  policy?: unknown;
  savedAt?: unknown;
  schemaVersion?: unknown;
  serverDeletedItemIds?: unknown;
};

export type ProductLaunchTrackerSummary = {
  id: string;
  workBatch: string;
  warehouseLocation: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  shoplingCategory: string;
  selfCodeBase: string;
  optionLabels: string[];
  optionLocations: Array<{ id: string; label: string; barcode: string; index: number }>;
  optionCount: number;
  orderOptions: UnknownRecord[];
  trackerRowNumber: number | null;
  source: UnknownRecord;
  shoplingProducts: UnknownRecord;
  chinaProductLinks: string[];
  detailPageAsset: UnknownRecord;
  readiness: { ready: boolean; errorCount: number; warningCount: number };
  stages: Record<string, { status: string; assignee: string }>;
  overallStatus: string;
  nextStage: string;
  progress: { completed: number; total: number };
  archivedAt: string | null;
  migrationReview: boolean;
  categoryAiSuggestion: string;
  categoryAiConfidence: number;
  categoryAiStatus: string;
  updatedAt: string;
  updatedBy: string;
  searchText: string;
};

export type ProductLaunchTrackerIndex = {
  state: ProductLaunchTrackerState;
  items: UnknownRecord[];
  itemsById: Map<string, UnknownRecord>;
  summaries: ProductLaunchTrackerSummary[];
  summariesById: Map<string, ProductLaunchTrackerSummary>;
  byBatch: Map<string, Set<string>>;
  byAssignee: Map<string, Set<string>>;
  byOverall: Map<string, Set<string>>;
  unfinishedIds: Set<string>;
  counts: Record<string, number>;
  filterOptions: { batches: string[]; assignees: string[] };
};

export type ProductLaunchTrackerPageQuery = {
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  batch?: unknown;
  assignee?: unknown;
  overall?: unknown;
  unfinishedOnly?: unknown;
  sort?: unknown;
  direction?: unknown;
};

export function buildProductLaunchTrackerIndex(
  stateInput: ProductLaunchTrackerState | null | undefined,
): ProductLaunchTrackerIndex {
  const state = isRecord(stateInput) ? stateInput : {};
  const items = Array.isArray(state.items)
    ? state.items.filter(isRecord).map((item) => item as UnknownRecord)
    : [];
  const summaries = items
    .map((item, index) => {
      const summary = summarizeProductLaunchTrackerItem(item);
      return {
        ...summary,
        trackerRowNumber: summary.trackerRowNumber ?? index + 1,
      };
    })
    .filter((item) => item.id);
  const itemsById = new Map<string, UnknownRecord>();
  const summariesById = new Map<string, ProductLaunchTrackerSummary>();
  const byBatch = new Map<string, Set<string>>();
  const byAssignee = new Map<string, Set<string>>();
  const byOverall = new Map<string, Set<string>>();
  const unfinishedIds = new Set<string>();
  const batches = new Set<string>();
  const assignees = new Set<string>();

  items.forEach((item) => {
    const id = text(item.id);
    if (id) itemsById.set(id, item);
  });

  for (const summary of summaries) {
    summariesById.set(summary.id, summary);
    if (summary.workBatch) {
      batches.add(summary.workBatch);
      addToSetMap(byBatch, summary.workBatch, summary.id);
    }
    const itemAssignees = new Set(
      Object.values(summary.stages)
        .map((stage) => stage.assignee)
        .filter(Boolean),
    );
    for (const assignee of itemAssignees) {
      assignees.add(assignee);
      addToSetMap(byAssignee, assignee, summary.id);
    }
    addToSetMap(byOverall, summary.overallStatus, summary.id);
    if (!["완료", "보관됨"].includes(summary.overallStatus)) {
      unfinishedIds.add(summary.id);
    }
  }

  const active = summaries.filter((item) => !item.archivedAt);
  const counts = {
    전체: active.length,
    "등록 준비": active.filter((item) => item.readiness.ready).length,
    "진행 중": active.filter((item) => item.overallStatus === "진행 중").length,
    보류: active.filter((item) => item.overallStatus === "보류").length,
    완료: active.filter((item) => item.overallStatus === "완료").length,
  };

  return {
    state,
    items,
    itemsById,
    summaries,
    summariesById,
    byBatch,
    byAssignee,
    byOverall,
    unfinishedIds,
    counts,
    filterOptions: {
      batches: [...batches].sort(localeCompare),
      assignees: [...assignees].sort(localeCompare),
    },
  };
}

export function queryProductLaunchTrackerPage(
  index: ProductLaunchTrackerIndex,
  query: ProductLaunchTrackerPageQuery,
) {
  const pageSize = clampInteger(
    query.pageSize,
    PRODUCT_LAUNCH_DEFAULT_PAGE_SIZE,
    1,
    PRODUCT_LAUNCH_MAX_PAGE_SIZE,
  );
  const requestedPage = clampInteger(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const search = normalizeSearch(query.search);
  const batch = text(query.batch);
  const assignee = text(query.assignee);
  const overall = text(query.overall);
  const unfinishedOnly = booleanValue(query.unfinishedOnly, true);
  const sort = text(query.sort);
  const direction = text(query.direction) === "asc" ? "asc" : "desc";

  let candidateIds: Set<string> | null = null;
  candidateIds = intersectCandidate(
    candidateIds,
    batch ? index.byBatch.get(batch) ?? new Set<string>() : null,
  );
  candidateIds = intersectCandidate(
    candidateIds,
    assignee ? index.byAssignee.get(assignee) ?? new Set<string>() : null,
  );
  candidateIds = intersectCandidate(
    candidateIds,
    overall ? index.byOverall.get(overall) ?? new Set<string>() : null,
  );
  candidateIds = intersectCandidate(
    candidateIds,
    unfinishedOnly ? index.unfinishedIds : null,
  );

  let rows = candidateIds
    ? [...candidateIds]
        .map((id) => index.summariesById.get(id))
        .filter((value): value is ProductLaunchTrackerSummary => Boolean(value))
    : [...index.summaries];

  if (search) rows = rows.filter((item) => item.searchText.includes(search));
  rows.sort(summaryComparator(sort, direction));

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    pageCount,
    total,
    items: rows.slice(offset, offset + pageSize).map(stripSearchText),
    counts: index.counts,
    filterOptions: index.filterOptions,
  };
}

export function getProductLaunchTrackerItem(
  index: ProductLaunchTrackerIndex,
  itemId: unknown,
) {
  const id = text(itemId);
  return id ? index.itemsById.get(id) ?? null : null;
}

export function summarizeProductLaunchTrackerItem(
  itemInput: UnknownRecord,
): ProductLaunchTrackerSummary {
  const item = isRecord(itemInput) ? itemInput : {};
  const id = text(item.id);
  const orderOptions = normalizeOrderOptions(item.orderOptions, item.options);
  const stages = Object.fromEntries(
    STAGES.map(({ key }) => {
      const candidate = asRecord(item.stages)[key];
      const stage: UnknownRecord = isRecord(candidate) ? candidate : {};
      return [
        key,
        {
          status: normalizeStatus(stage.status),
          assignee: text(stage.assignee),
        },
      ];
    }),
  ) as Record<string, { status: string; assignee: string }>;
  const archivedAt = nullableText(item.archivedAt);
  const overallStatus = overallStatusFor(stages, archivedAt);
  const progress = {
    completed: STAGES.filter(({ key }) => COMPLETE_STATUSES.has(stages[key].status)).length,
    total: STAGES.length,
  };
  const nextStage = nextStageFor(stages, archivedAt);
  const readiness = readinessFor(item, orderOptions);
  const optionLabels = orderOptions.map((option) => option.saleOption).filter(Boolean);
  const optionLocations = orderOptions.map((option, index) => ({
    id: text(option.id) || `option-${index + 1}`,
    label: option.saleOption || `${index + 1}번째 옵션`,
    barcode: option.barcode,
    index,
  }));
  const shoplingProducts = asRecord(item.shoplingProducts);
  const source = asRecord(item.source);
  const trackerRowNumber = positiveIntegerOrNull(item.trackerRowNumber) ??
    (Array.isArray(source.rows)
      ? source.rows.map(positiveIntegerOrNull).find((value) => value !== null) ?? null
      : null);
  const detailPageAssetSource = asRecord(item.detailPageAsset);
  const detailPageAsset = {
    status: text(detailPageAssetSource.status),
    resultId: text(detailPageAssetSource.resultId),
    detailImageUrl: text(detailPageAssetSource.detailImageUrl),
    mainImageUrl: text(detailPageAssetSource.mainImageUrl),
    additionalImageUrls: Array.isArray(detailPageAssetSource.additionalImageUrls)
      ? detailPageAssetSource.additionalImageUrls.map(text).filter(Boolean).slice(0, 10)
      : [],
    syncedAt: nullableText(detailPageAssetSource.syncedAt),
  };
  const detailPageSource = asRecord(item.detailPageSource);
  const rawChinaProductLinks = [
    item.primaryChinaProductLink,
    detailPageSource.primaryUrl,
    ...(Array.isArray(item.chinaProductLinks) ? item.chinaProductLinks : []),
    ...(Array.isArray(detailPageSource.urls) ? detailPageSource.urls : []),
  ];
  const chinaProductLinks = [
    ...new Set(
      rawChinaProductLinks
        .map((entry) => {
          if (!isRecord(entry)) return text(entry);
          return text(entry.url ?? entry.href ?? entry.value);
        })
        .filter(Boolean),
    ),
  ].slice(0, 5);
  const goodsKeys = Object.values(shoplingProducts)
    .map((value) => text(asRecord(value).goodsKey))
    .filter(Boolean);
  const categoryAiSuggestion = text(item.categoryAiSuggestion);
  const categoryAiStatus = text(item.categoryAiStatus);
  const searchText = normalizeSearch(
    [
      item.workBatch,
      item.warehouseLocation,
      item.barcode,
      item.modelNumber,
      item.productName,
      item.shoplingCategory,
      item.selfCodeBase,
      optionLabels.join(" "),
      optionLocations.map((option) => option.barcode).join(" "),
      item.notes,
      goodsKeys.join(" "),
      categoryAiSuggestion,
      ...Object.values(stages).flatMap((stage) => [stage.status, stage.assignee]),
    ].join(" "),
  );

  return {
    id,
    workBatch: text(item.workBatch),
    warehouseLocation: text(item.warehouseLocation),
    barcode: normalizeLocationCode(item.barcode),
    modelNumber: normalizeModelNumber(item.modelNumber),
    productName: text(item.productName),
    shoplingCategory: text(item.shoplingCategory),
    selfCodeBase: text(item.selfCodeBase),
    optionLabels,
    optionLocations,
    optionCount: optionLabels.length,
    orderOptions,
    trackerRowNumber,
    source,
    shoplingProducts,
    chinaProductLinks,
    detailPageAsset,
    readiness,
    stages,
    overallStatus,
    nextStage,
    progress,
    archivedAt,
    migrationReview: Boolean(item.migrationReview),
    categoryAiSuggestion,
    categoryAiConfidence: Math.max(0, Number(item.categoryAiConfidence) || 0),
    categoryAiStatus,
    updatedAt: text(item.updatedAt),
    updatedBy: text(item.updatedBy),
    searchText,
  };
}

export function applyProductLaunchTrackerMutation(
  stateInput: ProductLaunchTrackerState,
  input: unknown,
) {
  if (!isRecord(input)) throw new Error("변경 요청 객체가 필요합니다.");
  const operation = text(input.operation);
  const state = cloneState(stateInput);
  const items = Array.isArray(state.items)
    ? state.items.filter(isRecord).map((item) => ({ ...(item as UnknownRecord) }))
    : [];
  const changedIds = new Set<string>();
  const createdIds: string[] = [];
  const now = new Date().toISOString();

  if (operation === "patch_item") {
    const itemId = requiredText(input.itemId, "상품 ID가 필요합니다.");
    const index = items.findIndex((item) => text(item.id) === itemId);
    if (index < 0) throw new Error("수정할 상품을 찾지 못했습니다.");
    items[index] = patchItem(items[index], input, now);
    changedIds.add(itemId);
  } else if (operation === "bulk_patch_items") {
    const patches = Array.isArray(input.patches)
      ? input.patches.filter(isRecord)
      : [];
    if (!patches.length) throw new Error("변경할 상품 패치가 필요합니다.");
    if (patches.length > PRODUCT_LAUNCH_MUTATION_LIMIT) {
      throw new Error(`한 번에 최대 ${PRODUCT_LAUNCH_MUTATION_LIMIT}건까지 수정할 수 있습니다.`);
    }
    const seenIds = new Set<string>();
    for (const entry of patches) {
      const itemId = requiredText(entry.itemId, "상품 ID가 필요합니다.");
      if (seenIds.has(itemId)) {
        throw new Error("동일 상품의 패치가 중복되었습니다.");
      }
      seenIds.add(itemId);
      const patch = isRecord(entry.patch) ? entry.patch : null;
      if (!patch) throw new Error("상품 패치 객체가 필요합니다.");
      const index = items.findIndex((item) => text(item.id) === itemId);
      if (index < 0) throw new Error("수정할 상품을 찾지 못했습니다.");
      items[index] = patchItem(
        items[index],
        {
          patch,
          updatedBy: text(entry.updatedBy) || text(input.updatedBy),
        },
        now,
      );
      changedIds.add(itemId);
    }
  } else if (operation === "clear_category_ai_review") {
    const updatedBy =
      text(input.updatedBy) || "승준 · AI 카테고리 검토함 비우기";
    items.forEach((item, index) => {
      const reviewKeys = Object.keys(item).filter((key) =>
        key.startsWith("categoryAi"),
      );
      if (!reviewKeys.length) return;
      const next = { ...item };
      for (const key of reviewKeys) delete next[key];
      next.updatedAt = now;
      next.updatedBy = updatedBy;
      items[index] = normalizeWholeItem(next, now);
      const id = text(item.id);
      if (id) changedIds.add(id);
    });
  } else if (operation === "replace_item") {
    const itemId = requiredText(input.itemId, "상품 ID가 필요합니다.");
    const replacement = isRecord(input.item) ? input.item : null;
    if (!replacement) throw new Error("저장할 상품 데이터가 필요합니다.");
    const index = items.findIndex((item) => text(item.id) === itemId);
    if (index < 0) throw new Error("수정할 상품을 찾지 못했습니다.");
    items[index] = normalizeWholeItem({ ...items[index], ...replacement, id: itemId }, now);
    changedIds.add(itemId);
  } else if (operation === "bulk_stage") {
    const ids = uniqueStrings(input.itemIds).slice(0, PRODUCT_LAUNCH_MUTATION_LIMIT);
    if (!ids.length) throw new Error("변경할 상품을 선택하세요.");
    const stageKey = requiredText(input.stageKey, "변경할 단계를 선택하세요.");
    if (!STAGES.some((stage) => stage.key === stageKey)) {
      throw new Error("지원하지 않는 단계입니다.");
    }
    const status = normalizeStatus(input.status);
    if (!STATUS_OPTIONS.has(status)) throw new Error("지원하지 않는 상태입니다.");
    const reason = text(input.reason);
    const idSet = new Set(ids);
    items.forEach((item, index) => {
      const id = text(item.id);
      if (!idSet.has(id)) return;
      items[index] = patchStage(item, stageKey, status, reason, now);
      changedIds.add(id);
    });
  } else if (operation === "archive_items") {
    const ids = uniqueStrings(input.itemIds).slice(0, PRODUCT_LAUNCH_MUTATION_LIMIT);
    if (!ids.length) throw new Error("변경할 상품을 선택하세요.");
    const archived = input.archived !== false;
    const idSet = new Set(ids);
    items.forEach((item, index) => {
      const id = text(item.id);
      if (!idSet.has(id)) return;
      items[index] = {
        ...item,
        archivedAt: archived ? now : null,
        updatedAt: now,
        updatedBy: text(input.updatedBy) || "승준",
      };
      changedIds.add(id);
    });
  } else if (operation === "delete_items") {
    const ids = uniqueStrings(input.itemIds).slice(0, PRODUCT_LAUNCH_MUTATION_LIMIT);
    if (!ids.length) throw new Error("삭제할 상품을 선택하세요.");
    const deleted = new Set([
      ...uniqueStrings(state.serverDeletedItemIds),
      ...ids,
    ]);
    state.serverDeletedItemIds = [...deleted];
    state.items = items.filter((item) => !deleted.has(text(item.id)));
    state.savedAt = now;
    return { state, changedIds: ids, createdIds };
  } else if (operation === "create_items") {
    const rows = Array.isArray(input.items) ? input.items.filter(isRecord) : [];
    if (!rows.length) throw new Error("추가할 상품 데이터가 없습니다.");
    if (rows.length > PRODUCT_LAUNCH_MUTATION_LIMIT) {
      throw new Error(`한 번에 최대 ${PRODUCT_LAUNCH_MUTATION_LIMIT}건까지 추가할 수 있습니다.`);
    }
    const usedCodes = new Set(items.map((item) => text(item.selfCodeBase)).filter(Boolean));
    for (const row of rows) {
      const created = createItem(row as UnknownRecord, usedCodes, now);
      items.push(created);
      const id = text(created.id);
      changedIds.add(id);
      createdIds.push(id);
    }
  } else if (operation === "update_policy") {
    const policy = isRecord(input.policy) ? input.policy : null;
    if (!policy) throw new Error("저장할 통합정책이 필요합니다.");
    state.policy = { ...asRecord(state.policy), ...policy };
  } else {
    throw new Error("지원하지 않는 변경 작업입니다.");
  }

  state.items = items;
  state.savedAt = now;
  state.schemaVersion = Math.max(3, Math.floor(Number(state.schemaVersion) || 3));
  return { state, changedIds: [...changedIds], createdIds };
}

function patchItem(item: UnknownRecord, input: UnknownRecord, now: string) {
  const patch = isRecord(input.patch) ? { ...input.patch } : {};
  delete patch.id;
  let next = { ...item, ...patch };

  if (Object.prototype.hasOwnProperty.call(patch, "barcode")) {
    next.barcode = normalizeLocationCode(patch.barcode);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "modelNumber")) {
    next.modelNumber = normalizeModelNumber(patch.modelNumber);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "productName")) {
    next.productName = text(patch.productName);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "shoplingCategory")) {
    next.shoplingCategory = text(patch.shoplingCategory);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "workBatch")) {
    next.workBatch = text(patch.workBatch);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "warehouseLocation")) {
    next.warehouseLocation = text(patch.warehouseLocation);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
    next.notes = text(patch.notes);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "optionLabels")) {
    next.orderOptions = applyOptionLabels(next.orderOptions, patch.optionLabels, next.barcode);
    next.options = (next.orderOptions as UnknownRecord[]).map((option) => text(option.saleOption));
    delete next.optionLabels;
  }
  if (isRecord(input.optionLocation)) {
    next.orderOptions = applyOptionLocation(next.orderOptions, input.optionLocation);
  }
  if (isRecord(input.stage)) {
    const stageKey = text(input.stage.stageKey);
    const status = normalizeStatus(input.stage.status);
    if (STAGES.some((stage) => stage.key === stageKey) && STATUS_OPTIONS.has(status)) {
      next = patchStage(next, stageKey, status, text(input.stage.reason), now);
    }
  }

  next.updatedAt = now;
  next.updatedBy = text(input.updatedBy) || text(patch.updatedBy) || "승준";
  return normalizeWholeItem(next, now);
}

function patchStage(
  item: UnknownRecord,
  stageKey: string,
  status: string,
  reason: string,
  now: string,
) {
  const stages = { ...asRecord(item.stages) };
  const current = { ...asRecord(stages[stageKey]) };
  stages[stageKey] = {
    ...current,
    status,
    completedAt: status === "완료" ? text(current.completedAt) || now : null,
    note: reason || text(current.note),
  };
  return {
    ...item,
    stages,
    notes: reason ? appendNote(text(item.notes), reason) : item.notes,
    updatedAt: now,
    updatedBy: "승준",
  };
}

function normalizeWholeItem(item: UnknownRecord, now: string) {
  const barcode = normalizeLocationCode(item.barcode);
  const orderOptions = normalizeOrderOptions(item.orderOptions, item.options);
  if (orderOptions.length === 1 && barcode) orderOptions[0].barcode = barcode;
  return {
    ...item,
    id: text(item.id) || randomId(),
    workBatch: text(item.workBatch),
    warehouseLocation: text(item.warehouseLocation),
    barcode,
    modelNumber: normalizeModelNumber(item.modelNumber),
    productName: text(item.productName),
    shoplingCategory: text(item.shoplingCategory),
    selfCodeBase: text(item.selfCodeBase),
    notes: text(item.notes),
    orderOptions,
    options: orderOptions.map((option) => option.saleOption).filter(Boolean),
    updatedAt: text(item.updatedAt) || now,
    updatedBy: text(item.updatedBy) || "승준",
  };
}

function createItem(row: UnknownRecord, usedCodes: Set<string>, now: string) {
  const selfCodeBase = text(row.selfCodeBase) || generateSelfCode(usedCodes);
  usedCodes.add(selfCodeBase);
  const barcode = normalizeLocationCode(row.barcode);
  const labels = normalizeOptionLabels(row.optionLabels ?? row.options);
  const orderOptions = applyOptionLabels(row.orderOptions, labels, barcode);
  const stages = Object.fromEntries(
    STAGES.map(({ key }) => [
      key,
      {
        status: "미시작",
        assignee: "",
        completedAt: null,
        note: "",
      },
    ]),
  );
  return normalizeWholeItem(
    {
      ...row,
      id: text(row.id) || randomId(),
      selfCodeBase,
      barcode,
      orderOptions,
      stages: isRecord(row.stages) ? row.stages : stages,
      archivedAt: null,
      createdAt: text(row.createdAt) || now,
      updatedAt: now,
      updatedBy: text(row.updatedBy) || "승준",
      source: isRecord(row.source)
        ? row.source
        : { file: text(row.sourceFile) || "직접 추가", sheet: "", rows: [], sheetRowRefs: [] },
    },
    now,
  );
}

function normalizeOrderOptions(value: unknown, legacy: unknown) {
  const source = Array.isArray(value) && value.length
    ? value
    : normalizeOptionLabels(legacy).map((saleOption, index) => ({
        id: `legacy-${index + 1}`,
        saleOption,
      }));
  return source
    .map((entry, index) => {
      const option: UnknownRecord = isRecord(entry) ? entry : { saleOption: entry };
      return {
        ...option,
        id: text(option.id) || `option-${index + 1}`,
        optionName: text(option.optionName) || "옵션",
        saleOption: text(option.saleOption ?? option.value),
        chinaOption: text(option.chinaOption),
        barcode: normalizeLocationCode(option.barcode),
        baseSalePriceKrw: nonNegativeInteger(option.baseSalePriceKrw),
        unitCostKrw: nonNegativeInteger(option.unitCostKrw),
        sourceOrderItemId:
          option.sourceOrderItemId === null || option.sourceOrderItemId === undefined
            ? null
            : text(option.sourceOrderItemId),
      };
    })
    .filter(
      (option) => option.saleOption || option.barcode || option.baseSalePriceKrw > 0 || option.unitCostKrw > 0,
    );
}

function applyOptionLabels(currentValue: unknown, labelsValue: unknown, mainBarcode: unknown) {
  const labels = normalizeOptionLabels(labelsValue);
  const current = normalizeOrderOptions(currentValue, []);
  const next = labels.map((label, index) => ({
    ...(current[index] ?? {}),
    id: text(current[index]?.id) || randomId(),
    optionName: text(current[index]?.optionName) || "옵션",
    saleOption: label,
    barcode: normalizeLocationCode(current[index]?.barcode),
    baseSalePriceKrw: nonNegativeInteger(current[index]?.baseSalePriceKrw),
    unitCostKrw: nonNegativeInteger(current[index]?.unitCostKrw),
    sourceOrderItemId: current[index]?.sourceOrderItemId ?? null,
  }));
  if (next.length === 1) next[0].barcode = normalizeLocationCode(mainBarcode) || next[0].barcode;
  return next;
}

function applyOptionLocation(currentValue: unknown, locationInput: UnknownRecord) {
  const current = normalizeOrderOptions(currentValue, []);
  const optionId = text(locationInput.optionId);
  const optionIndex = Number(locationInput.optionIndex);
  let targetIndex = optionId
    ? current.findIndex((option) => text(option.id) === optionId)
    : -1;
  if (targetIndex < 0 && Number.isInteger(optionIndex) && current[optionIndex]) {
    targetIndex = optionIndex;
  }
  if (targetIndex < 0) throw new Error("위치코드를 저장할 옵션을 찾지 못했습니다.");
  current[targetIndex] = {
    ...current[targetIndex],
    barcode: normalizeLocationCode(locationInput.barcode),
  };
  return current;
}

function readinessFor(item: UnknownRecord, options: UnknownRecord[]) {
  let errorCount = 0;
  let warningCount = 0;
  if (!normalizeModelNumber(item.modelNumber)) errorCount += 1;
  if (!text(item.productName)) errorCount += 1;
  if (!text(item.shoplingCategory)) errorCount += 1;
  if (!text(item.selfCodeBase)) errorCount += 1;
  const detail = asRecord(item.detailPageAsset);
  if (!text(detail.html)) errorCount += 1;
  if (!text(detail.mainImageUrl)) errorCount += 1;
  if (!options.length) errorCount += 1;
  const seen = new Set<string>();
  for (const option of options) {
    if (!text(option.saleOption)) errorCount += 1;
    const barcode = normalizeLocationCode(option.barcode);
    if (!barcode) errorCount += 1;
    if (!(Number(option.baseSalePriceKrw) > 0)) errorCount += 1;
    if (!(Number(option.unitCostKrw) > 0)) warningCount += 1;
    if (barcode && seen.has(barcode)) errorCount += 1;
    if (barcode) seen.add(barcode);
  }
  return { ready: errorCount === 0, errorCount, warningCount };
}

function overallStatusFor(
  stages: Record<string, { status: string; assignee: string }>,
  archivedAt: string | null,
) {
  if (archivedAt) return "보관됨";
  const statuses = STAGES.map(({ key }) => stages[key]?.status ?? "미시작");
  if (statuses.includes("보류")) return "보류";
  if (statuses.every((status) => COMPLETE_STATUSES.has(status))) return "완료";
  if (statuses.every((status) => status === "미시작")) return "미시작";
  return "진행 중";
}

function nextStageFor(
  stages: Record<string, { status: string; assignee: string }>,
  archivedAt: string | null,
) {
  if (archivedAt) return "보관됨";
  const held = STAGES.find(({ key }) => stages[key]?.status === "보류");
  if (held) return `${held.label} 보류`;
  const next = STAGES.find(({ key }) => !COMPLETE_STATUSES.has(stages[key]?.status));
  return next?.label ?? "출시 완료";
}

function summaryComparator(sort: string, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  const stageKey = STAGES.find(({ key }) => key === sort)?.key;
  return (left: ProductLaunchTrackerSummary, right: ProductLaunchTrackerSummary) => {
    let compared = 0;
    if (stageKey) {
      compared = statusRank(left.stages[stageKey]?.status) - statusRank(right.stages[stageKey]?.status);
    } else if (sort === "options") {
      compared = left.optionLabels.join(", ").localeCompare(right.optionLabels.join(", "), "ko-KR", {
        numeric: true,
        sensitivity: "base",
      });
    } else if (sort === "readiness") {
      compared = Number(left.readiness.ready) - Number(right.readiness.ready);
    } else if (sort === "nextStage") {
      compared = left.nextStage.localeCompare(right.nextStage, "ko-KR", {
        numeric: true,
        sensitivity: "base",
      });
    } else if (sort && Object.prototype.hasOwnProperty.call(left, sort)) {
      compared = String((left as unknown as UnknownRecord)[sort] ?? "").localeCompare(
        String((right as unknown as UnknownRecord)[sort] ?? ""),
        "ko-KR",
        { numeric: true, sensitivity: "base" },
      );
    }
    if (!compared) {
      compared = defaultSummaryCompare(left, right);
      return compared;
    }
    return compared * sign;
  };
}

function defaultSummaryCompare(left: ProductLaunchTrackerSummary, right: ProductLaunchTrackerSummary) {
  const updated = timestamp(right.updatedAt) - timestamp(left.updatedAt);
  if (updated) return updated;
  return right.modelNumber.localeCompare(left.modelNumber, "ko-KR", {
    numeric: true,
    sensitivity: "base",
  });
}

function stripSearchText(item: ProductLaunchTrackerSummary) {
  const { searchText: _searchText, ...summary } = item;
  return summary;
}

function normalizeOptionLabels(value: unknown) {
  const input = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,/\n]+/);
  return [...new Set(input.map((entry) => text(entry)).filter(Boolean))];
}

function normalizeModelNumber(value: unknown) {
  const compact = text(value).toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

function normalizeLocationCode(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeStatus(value: unknown) {
  const status = text(value) || "미시작";
  return STATUS_OPTIONS.has(status) ? status : "미시작";
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ");
}

function intersectCandidate(current: Set<string> | null, next?: Set<string> | null) {
  if (!next) return current;
  if (!current) return new Set(next);
  const result = new Set<string>();
  const [small, large] = current.size <= next.size ? [current, next] : [next, current];
  for (const value of small) if (large.has(value)) result.add(value);
  return result;
}

function addToSetMap(map: Map<string, Set<string>>, key: string, id: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(id);
  map.set(key, values);
}

function cloneState(state: ProductLaunchTrackerState) {
  return JSON.parse(JSON.stringify(isRecord(state) ? state : {})) as ProductLaunchTrackerState;
}

function appendNote(current: string, next: string) {
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current} · ${next}`;
}

function generateSelfCode(used: Set<string>) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let suffix = "";
    const bytes = new Uint8Array(10);
    globalThis.crypto?.getRandomValues?.(bytes);
    for (let index = 0; index < bytes.length; index += 1) {
      suffix += alphabet[bytes[index] % alphabet.length];
    }
    const candidate = `PL${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("중복되지 않는 자사상품코드를 만들지 못했습니다.");
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueStrings(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
}

function requiredText(value: unknown, message: string) {
  const result = text(value);
  if (!result) throw new Error(message);
  return result;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no"].includes(text(value).toLowerCase());
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function positiveIntegerOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Math.ceil(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function localeCompare(left: string, right: string) {
  return left.localeCompare(right, "ko-KR", { numeric: true, sensitivity: "base" });
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function statusRank(status: string) {
  return ["미시작", "진행 중", "보류", "완료", "제외"].indexOf(status);
}
