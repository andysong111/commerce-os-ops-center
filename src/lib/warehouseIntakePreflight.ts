export type WarehouseIntakeInput = {
  productCount: number;
  optionsPerProduct: number;
  slotsPerSku: number;
  committedSlots: number;
};

export type WarehouseIntakeSnapshot = {
  generatedAt: string;
  registryComplete: boolean;
  sourcingIntakeGate: string;
  freeRegisteredSlotCount: number;
  reserveSlotCount: number;
  safeImmediateNewSkuCapacity: number | null;
  unregisteredOccupiedLocationCount: number;
  occupiedBlockedLocationCount: number;
  occupancyCollisionCount: number;
};

export type WarehouseIntakePreflight = {
  mode: "DRY_RUN";
  executionAllowed: false;
  capacityBasis: "LOCATION_CODE_COUNT_ONLY";
  evaluatedAt: string;
  snapshotGeneratedAt: string;
  input: WarehouseIntakeInput;
  decision: "BLOCKED" | "SPACE_ONLY_FITS" | "SPACE_SHORTFALL";
  reasons: string[];
  requestedSkuCount: number;
  requiredSlots: number;
  availableSlots: number | null;
  shortfallSlots: number | null;
  maxProductCountBySpace: number | null;
};

const MAX_COUNT = 100_000;
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;

function count(value: unknown, name: string, minimum: number) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^\d+$/.test(value.trim()))
  ) {
    throw new Error(`INVALID_${name}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > MAX_COUNT) {
    throw new Error(`INVALID_${name}`);
  }
  return parsed;
}

export function parseWarehouseIntakeInput(input: Record<string, unknown>): WarehouseIntakeInput {
  // All inputs are explicit, including pending unallocated commitments. Missing
  // inbound commitments must not quietly become zero and overstate capacity.
  return {
    productCount: count(input.productCount, "PRODUCT_COUNT", 1),
    optionsPerProduct: count(input.optionsPerProduct, "OPTIONS_PER_PRODUCT", 1),
    slotsPerSku: count(input.slotsPerSku, "SLOTS_PER_SKU", 1),
    committedSlots: count(input.committedSlots, "COMMITTED_SLOTS", 0),
  };
}

function validNonnegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function evaluateWarehouseIntakePreflight(
  snapshot: WarehouseIntakeSnapshot,
  rawInput: Record<string, unknown>,
  nowMs = Date.now(),
): WarehouseIntakePreflight {
  const input = parseWarehouseIntakeInput(rawInput);
  const reasons: string[] = [];
  const generatedMs = Date.parse(snapshot.generatedAt);
  if (
    !Number.isFinite(generatedMs) ||
    !Number.isFinite(nowMs) ||
    nowMs - generatedMs > MAX_SNAPSHOT_AGE_MS ||
    generatedMs - nowMs > MAX_FUTURE_SKEW_MS
  ) {
    reasons.push("STALE_OR_INVALID_SNAPSHOT");
  }
  if (snapshot.registryComplete !== true) reasons.push("PHYSICAL_REGISTRY_UNCONFIRMED");
  if (snapshot.sourcingIntakeGate !== "READY") reasons.push("CAPACITY_GATE_NOT_READY");
  if ([
    snapshot.unregisteredOccupiedLocationCount,
    snapshot.occupiedBlockedLocationCount,
    snapshot.occupancyCollisionCount,
  ].some((value) => !validNonnegativeCount(value) || value !== 0)) {
    reasons.push("CAPACITY_DATA_CONFLICT");
  }
  if (
    !validNonnegativeCount(snapshot.freeRegisteredSlotCount) ||
    !validNonnegativeCount(snapshot.reserveSlotCount) ||
    !validNonnegativeCount(snapshot.safeImmediateNewSkuCapacity) ||
    snapshot.safeImmediateNewSkuCapacity !== Math.max(
      0, snapshot.freeRegisteredSlotCount - snapshot.reserveSlotCount,
    )
  ) {
    reasons.push("IMMEDIATE_CAPACITY_INVALID");
  }

  const requestedSkuCount = input.productCount * input.optionsPerProduct;
  const requiredSlots = requestedSkuCount * input.slotsPerSku;
  if (!Number.isSafeInteger(requiredSlots)) throw new Error("INVALID_REQUIRED_SLOTS");
  const availableSlots = reasons.length === 0
    ? Math.max(0, snapshot.safeImmediateNewSkuCapacity! - input.committedSlots)
    : null;
  const shortfallSlots = availableSlots === null ? null : Math.max(0, requiredSlots - availableSlots);
  const maxProductCountBySpace = availableSlots === null
    ? null
    : Math.floor(availableSlots / (input.optionsPerProduct * input.slotsPerSku));

  return {
    mode: "DRY_RUN",
    executionAllowed: false,
    capacityBasis: "LOCATION_CODE_COUNT_ONLY",
    evaluatedAt: new Date(nowMs).toISOString(),
    snapshotGeneratedAt: snapshot.generatedAt,
    input,
    decision: availableSlots === null
      ? "BLOCKED"
      : requiredSlots <= availableSlots ? "SPACE_ONLY_FITS" : "SPACE_SHORTFALL",
    reasons,
    requestedSkuCount,
    requiredSlots,
    availableSlots,
    shortfallSlots,
    maxProductCountBySpace,
  };
}
