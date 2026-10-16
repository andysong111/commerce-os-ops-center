import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type R = Record<string, unknown>;

export type ChinaPurchaseComponent = {
  chinaOption: string;
  quantityMultiplier: number;
};

export type ChinaPurchasePolicy = {
  status: "ACTIVE" | "DISCONTINUED";
  quantityMultiplier: number;
  components: ChinaPurchaseComponent[];
  optionSelection: "EXACT" | "ANY_AVAILABLE";
  source: "user_confirmed_20261017";
  updatedAt: string;
};

type OptionOverride = {
  barcode: string;
  chinaOption?: string;
  status?: ChinaPurchasePolicy["status"];
  quantityMultiplier?: number;
  components?: ChinaPurchaseComponent[];
  optionSelection?: ChinaPurchasePolicy["optionSelection"];
};

type ModelOverride = {
  modelNumber: string;
  supplierLink?: string;
  archived?: boolean;
  options?: OptionOverride[];
};

export const USER_CHINA_PURCHASE_OVERRIDES_20261017: ModelOverride[] = [
  {
    modelNumber: "AAA127",
    options: [{
      barcode: "BCB3-1",
      chinaOption: "金属钳子 + 空心银色50套",
      components: [
        { chinaOption: "金属钳子", quantityMultiplier: 1 },
        { chinaOption: "空心银色50套", quantityMultiplier: 1 },
      ],
    }],
  },
  {
    modelNumber: "AAA015",
    options: [
      { barcode: "BCD6-2", chinaOption: "玫瑰粉色（100个倍数）,S号" },
      { barcode: "BCD6-1", chinaOption: "玫瑰粉色（100个倍数）,M号" },
    ],
  },
  {
    modelNumber: "AAA022",
    options: [
      { barcode: "BDE5-3", status: "DISCONTINUED" },
      { barcode: "BDE6-1", status: "DISCONTINUED" },
      { barcode: "BDE6-2", status: "DISCONTINUED" },
      { barcode: "BDE6-3", status: "DISCONTINUED" },
    ],
  },
  {
    modelNumber: "AAA027",
    options: [
      { barcode: "BGA1-1", chinaOption: "磁吸白色大号" },
      { barcode: "BGA4-1", chinaOption: "磁吸黑色大号" },
    ],
  },
  {
    modelNumber: "AAA186",
    options: [
      { barcode: "BCB6-3", chinaOption: "灰色", quantityMultiplier: 2 },
      { barcode: "BCB6-2", chinaOption: "黑色", quantityMultiplier: 2 },
    ],
  },
  {
    modelNumber: "AAA187",
    archived: true,
    options: [
      { barcode: "BCB7-2", status: "DISCONTINUED" },
      { barcode: "BCB7-3", status: "DISCONTINUED" },
    ],
  },
  {
    modelNumber: "AAA228",
    archived: true,
  },
  {
    modelNumber: "AAA318",
    supplierLink: "https://detail.1688.com/offer/1063136870043.html?sourceId=V1-26b2947f52787f2171dbf77a72a728ce-S04&spm=a26352.b28411319/2508.0.0",
    options: [
      { barcode: "BAC1-1", chinaOption: "灰色" },
      { barcode: "BAC1-3", chinaOption: "白色" },
      { barcode: "BAC2-1", chinaOption: "粉色" },
    ],
  },
  {
    modelNumber: "AAA342",
    archived: true,
  },
  {
    modelNumber: "AAA030",
    options: [
      { barcode: "BDE1-2", chinaOption: "白色,小号" },
      { barcode: "BDE1-1", chinaOption: "黑色,小号" },
    ],
  },
  {
    modelNumber: "AAA040",
    archived: true,
  },
  {
    modelNumber: "AAA086",
    supplierLink: "https://detail.1688.com/offer/754746673235.html?spm=a26352.b28411319.offerlist.6.355a1e62pdxMEU",
    options: [{ barcode: "BDF1-1", chinaOption: "海獭" }],
  },
  {
    modelNumber: "AAA483",
    options: [{
      barcode: "BEE5-1",
      chinaOption: "任一可售颜色（自动）",
      optionSelection: "ANY_AVAILABLE",
    }],
  },
];

export function prepareUserChinaPurchaseRules20261017(
  input: ProductLaunchTrackerState,
  now = new Date().toISOString(),
) {
  const state = clone(input);
  const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
  const overrideByModel = new Map(
    USER_CHINA_PURCHASE_OVERRIDES_20261017.map((override) => [override.modelNumber, override]),
  );
  const changedItemIds: string[] = [];
  const matchedModels = new Set<string>();
  const matchedBarcodes = new Set<string>();
  let changedOptions = 0;
  let discontinuedOptions = 0;
  let quantityRuleOptions = 0;
  let componentRuleOptions = 0;
  let anyAvailableOptions = 0;
  let changedLinks = 0;
  let archivedModels = 0;

  state.items = items.map((item) => {
    const modelNumber = normalize(item.modelNumber);
    const override = overrideByModel.get(modelNumber);
    if (!override) return item;
    matchedModels.add(modelNumber);
    let changed = false;
    let next = { ...item };

    if (override.supplierLink) {
      const currentLinks = Array.isArray(item.chinaProductLinks)
        ? item.chinaProductLinks.map(text).filter(Boolean)
        : [];
      const nextLinks = [override.supplierLink, ...currentLinks.filter((value) => supplierKey(value) !== supplierKey(override.supplierLink))];
      if (text(item.primaryChinaProductLink) !== override.supplierLink || JSON.stringify(currentLinks) !== JSON.stringify(nextLinks)) {
        next.primaryChinaProductLink = override.supplierLink;
        next.chinaProductLinks = nextLinks;
        const detailPageSource = isRecord(item.detailPageSource) ? item.detailPageSource : {};
        next.detailPageSource = {
          ...detailPageSource,
          urls: nextLinks,
          primaryUrl: override.supplierLink,
          pinnedIndex: 0,
          updatedAt: now,
        };
        changedLinks += 1;
        changed = true;
      }
    }

    if (override.archived && !text(item.archivedAt)) {
      next.archivedAt = now;
      next.archiveReason = "사용자 확인 단종 · 2026-10-17";
      archivedModels += 1;
      changed = true;
    }

    const byBarcode = new Map((override.options ?? []).map((option) => [normalize(option.barcode), option]));
    if (byBarcode.size) {
      const currentOptions = Array.isArray(item.orderOptions) ? item.orderOptions : [];
      next.orderOptions = currentOptions.map((rawOption) => {
        const option = isRecord(rawOption) ? rawOption : {};
        const optionOverride = byBarcode.get(normalize(option.barcode));
        if (!optionOverride) return option;
        matchedBarcodes.add(normalize(option.barcode));
        const previousPolicy = isRecord(option.purchasePolicy) ? option.purchasePolicy : {};
        const policy: ChinaPurchasePolicy = {
          status: optionOverride.status ?? (text(previousPolicy.status) === "DISCONTINUED" ? "DISCONTINUED" : "ACTIVE"),
          quantityMultiplier: positiveInteger(optionOverride.quantityMultiplier ?? previousPolicy.quantityMultiplier, 1),
          components: (optionOverride.components ?? componentList(previousPolicy.components)).map((component) => ({
            chinaOption: text(component.chinaOption),
            quantityMultiplier: positiveInteger(component.quantityMultiplier, 1),
          })).filter((component) => component.chinaOption),
          optionSelection: optionOverride.optionSelection ?? (text(previousPolicy.optionSelection) === "ANY_AVAILABLE" ? "ANY_AVAILABLE" : "EXACT"),
          source: "user_confirmed_20261017",
          updatedAt: now,
        };
        const nextOption = {
          ...option,
          ...(optionOverride.chinaOption === undefined ? {} : { chinaOption: optionOverride.chinaOption }),
          purchasePolicy: policy,
        };
        if (JSON.stringify(option) !== JSON.stringify(nextOption)) {
          changedOptions += 1;
          changed = true;
        }
        if (policy.status === "DISCONTINUED") discontinuedOptions += 1;
        if (policy.quantityMultiplier > 1) quantityRuleOptions += 1;
        if (policy.components.length) componentRuleOptions += 1;
        if (policy.optionSelection === "ANY_AVAILABLE") anyAvailableOptions += 1;
        return nextOption;
      });
    }

    if (!changed) return item;
    changedItemIds.push(text(item.id));
    return { ...next, updatedAt: now, updatedBy: "승준" };
  });

  const missingModels = USER_CHINA_PURCHASE_OVERRIDES_20261017
    .map((override) => override.modelNumber)
    .filter((modelNumber) => !matchedModels.has(modelNumber));
  const expectedBarcodes = USER_CHINA_PURCHASE_OVERRIDES_20261017
    .flatMap((override) => override.options ?? [])
    .map((option) => option.barcode);
  const missingBarcodes = expectedBarcodes.filter((barcode) => !matchedBarcodes.has(barcode));

  return {
    state,
    changedItemIds,
    report: {
      version: "2026-10-17-user-china-purchase-rules-v1",
      requestedModels: USER_CHINA_PURCHASE_OVERRIDES_20261017.length,
      matchedModels: matchedModels.size,
      changedItems: changedItemIds.length,
      changedOptions,
      changedLinks,
      archivedModels,
      discontinuedOptions,
      quantityRuleOptions,
      componentRuleOptions,
      anyAvailableOptions,
      missingModels,
      missingBarcodes,
    },
  };
}

export function isPurchaseOptionDiscontinued(option: unknown) {
  return text(isRecord(option) ? object(option.purchasePolicy).status : "") === "DISCONTINUED";
}

function componentList(value: unknown): ChinaPurchaseComponent[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((row) => ({
        chinaOption: text(row.chinaOption),
        quantityMultiplier: positiveInteger(row.quantityMultiplier, 1),
      }))
    : [];
}

function supplierKey(value: unknown) {
  try {
    const url = new URL(text(value));
    return url.pathname.match(/\/offer\/(\d+)\.html/i)?.[1] || url.toString();
  } catch {
    return text(value);
  }
}

function normalize(value: unknown) { return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, ""); }
function positiveInteger(value: unknown, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function object(value: unknown): R { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is R { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown) { return String(value ?? "").trim(); }
