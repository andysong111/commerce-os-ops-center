import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  MAX_CHINA_PRODUCT_LINKS,
  normalizeChinaProductUrl,
  readChinaLinkUsage,
  readLegacyChinaLinkUsage,
} from "../public/product-launch-tracker-app/lib/china-product-links.mjs";

const DEFAULT_ORIGIN = "https://commerce-os-ops-center.vercel.app";
const API_PATH = "/api/product-launch-tracker/optimized";
const DIRECT_DETAIL_API_PATH = "/api/product-launch-tracker/item-editor";
const RECEIPT_VERSION = 1;
const BATCH_SIZE = 30;

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value.trim() : "";
const ownsLinkUsage = (item) => Object.hasOwn(item, "chinaLinkUsage");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function readSnapshot(body) {
  const updatedAt = text(body?.updatedAt);
  if (body?.ok !== true || body.stateExists !== true || !updatedAt || !Array.isArray(body.state?.items)) {
    throw new Error("상품출시 진행관리 내보내기 또는 저장 시각이 없어서 이관을 진행할 수 없습니다.");
  }
  const items = new Map();
  for (const item of body.state.items) {
    const id = text(item?.id);
    if (!isRecord(item) || !id || items.has(id) || !text(item.updatedAt)) {
      throw new Error("상품 내보내기에 상품 ID 또는 저장 시각이 없거나 ID가 중복됩니다.");
    }
    items.set(id, item);
  }
  return { updatedAt, items };
}

function conflictingPrimaryAlias(item, commonUrl) {
  for (const alias of [item.primaryChinaProductLink, item.detailPageSource?.primaryUrl]) {
    if (!text(alias)) continue;
    try {
      if (normalizeChinaProductUrl(alias) !== commonUrl) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function planChinaLinkUsageMigration(body) {
  const snapshot = readSnapshot(body);
  const patches = [];
  const report = {
    total: snapshot.items.size,
    alreadyMigrated: 0,
    noLinks: 0,
    singleLink: 0,
    multipleLinks: 0,
    conflictingPrimaryAliasCount: 0,
    invalidItemIds: [],
  };
  for (const [itemId, item] of snapshot.items) {
    if (ownsLinkUsage(item)) {
      if (isRecord(item.chinaLinkUsage)) report.alreadyMigrated++;
      else report.invalidItemIds.push(itemId);
      continue;
    }
    let usage;
    try {
      usage = readLegacyChinaLinkUsage(item);
    } catch {
      report.invalidItemIds.push(itemId);
      continue;
    }
    if (!usage.commonUrl) {
      report.noLinks++;
      continue;
    }
    if (usage.purchaseAlternates.length) report.multipleLinks++;
    else report.singleLink++;
    if (conflictingPrimaryAlias(item, usage.commonUrl)) report.conflictingPrimaryAliasCount++;
    patches.push(migrationPatch(item, usage));
  }
  patches.sort((left, right) => left.itemId.localeCompare(right.itemId, "en"));
  return {
    snapshot,
    patches,
    report,
    digest: hash({ updatedAt: snapshot.updatedAt, patches, report }),
  };
}

function migrationPatch(item, usage) {
  return {
    itemId: item.id,
    expectedUpdatedAt: item.updatedAt,
    patch: { chinaLinkUsage: usage },
  };
}

function checkOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value) {
    throw new Error("HTTPS 원본 주소만 사용할 수 있습니다.");
  }
  return value;
}

export function makeMigrationTransport(origin, env = process.env, fetchFn = fetch) {
  checkOrigin(origin);
  const headers = {
    Accept: "application/json",
    Origin: origin,
    Referer: `${origin}/product-launch-tracker`,
    "Sec-Fetch-Site": "same-origin",
  };
  if (env.OPS_PRODUCT_LAUNCH_SESSION_COOKIE) {
    headers.Cookie = env.OPS_PRODUCT_LAUNCH_SESSION_COOKIE;
  }
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  return async (query, input) => {
    const path = query.startsWith("?mode=items-direct&") ? DIRECT_DETAIL_API_PATH : API_PATH;
    const response = await fetchFn(`${origin}${path}${query}`, {
      method: input ? "PATCH" : "GET",
      headers: input ? { ...headers, "Content-Type": "application/json" } : headers,
      body: input ? JSON.stringify(input) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(95_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      throw new Error(`상품출시 진행관리 API 응답 오류 (${response.status}).`);
    }
    return body;
  };
}

function assertSamePatchIds(actualIds, batch) {
  const expected = batch.map(({ itemId }) => itemId).sort();
  if (!Array.isArray(actualIds) || hash([...actualIds].sort()) !== hash(expected)) {
    throw new Error("저장된 상품 ID가 이번 이관 대상과 일치하지 않습니다.");
  }
}

function assertReadbackItem(next, previous, usage) {
  if (!isRecord(next)) throw new Error("저장한 상품의 원본을 다시 확인할 수 없습니다.");
  if (!matchesStoredUsage(next, usage) ||
      hash(withoutChinaLinkUsage(next)) !== hash(withoutChinaLinkUsage(previous))) {
    throw new Error("이관된 링크나 상품의 기존 데이터가 예상과 일치하지 않습니다.");
  }
}

function withoutChinaLinkUsage(item) {
  const copy = { ...item };
  delete copy.chinaLinkUsage;
  return copy;
}

function matchesStoredUsage(item, usage) {
  return usage === null
    ? !ownsLinkUsage(item)
    : isRecord(item.chinaLinkUsage) && hash(item.chinaLinkUsage) === hash(usage);
}

async function readDetailBatch(query, batch) {
  const ids = new URLSearchParams([["mode", "items-direct"], ...batch.map(({ itemId }) => ["id", itemId])]);
  const body = await query(`?${ids}`);
  const items = new Map((body.items ?? []).map((item) => [item.id, item]));
  assertSamePatchIds([...items.keys()], batch);
  if (body.itemSource !== "normalized-direct") {
    throw new Error("정규화된 상품 상세 조회를 확인할 수 없습니다.");
  }
  return items;
}

function isVerifiedHistoricalPurchaseWrite(raw, detail, rawUsage, detailUsage) {
  const receipt = raw.purchaseMetadataLastWrite;
  const savedAt = Date.parse(receipt?.savedAt);
  const writeDelay = Date.parse(raw.updatedAt) - savedAt;
  const rawLinks = [rawUsage.commonUrl, ...rawUsage.purchaseAlternates].filter(Boolean);
  const detailLinks = [detailUsage.commonUrl, ...detailUsage.purchaseAlternates].filter(Boolean);
  const source = raw.detailPageSource;
  const model = text(raw.modelNumber);
  const barcodes = receipt?.barcodes;
  if (
    !model || model !== text(detail.modelNumber) || model !== text(receipt?.modelNo) ||
    raw.updatedBy !== "중국 발주초안 구매정보 역저장" ||
    receipt?.field !== "MODEL_LINK_AND_BCODE_CHINA_OPTION" ||
    receipt.source !== "CHINA_ORDER_DRAFT" || receipt.savedBy !== "승준" ||
    !/^fast-purchase-draft:[a-f0-9]{20}$/.test(text(receipt.draftId)) ||
    !Array.isArray(barcodes) || !barcodes.length || new Set(barcodes).size !== barcodes.length ||
    !barcodes.every((value) => /^B[A-Z]{2}\d+-\d+$/.test(value)) ||
    !Number.isFinite(savedAt) || writeDelay < 0 || writeDelay > 1_000 || Date.parse(detail.updatedAt) >= savedAt ||
    !rawLinks[0] || !detailLinks[0] ||
    raw.primaryChinaProductLink !== rawLinks[0] || source?.primaryUrl !== rawLinks[0] ||
    source?.pinnedIndex !== 0 || hash(source?.urls ?? null) !== hash(rawLinks) ||
    hash(raw.chinaProductLinks ?? null) !== hash(rawLinks)
  ) return false;

  if (rawLinks[0] !== detailLinks[0]) {
    // The historical draft writer set the new first URL and kept old URLs in order.
    const promoted = [rawLinks[0], ...detailLinks.filter((url) => url !== rawLinks[0])];
    return hash(rawLinks) === hash(promoted.slice(0, MAX_CHINA_PRODUCT_LINKS));
  }

  // The first URL is identical and every old candidate survives in order.
  // Accept exactly one added candidate, never replacement of an existing one.
  return rawLinks.length === detailLinks.length + 1 &&
    hash(rawLinks.filter((url) => detailLinks.includes(url))) === hash(detailLinks);
}

async function verifyBeforeWrite(query, batch, snapshot) {
  const details = await readDetailBatch(query, batch);
  const guarded = [];
  let recognizedHistoricalWrites = 0;
  let newerMatchingDetails = 0;
  for (const entry of batch) {
    const { itemId } = entry;
    const raw = snapshot.items.get(itemId);
    const detail = details.get(itemId);
    const rawDate = Date.parse(raw.updatedAt);
    const detailDate = Date.parse(detail.updatedAt);
    const rawHasCanonical = ownsLinkUsage(raw);
    const detailHasCanonical = ownsLinkUsage(detail);
    const rawUsage = rawHasCanonical ? raw.chinaLinkUsage : readLegacyChinaLinkUsage(raw);
    const detailUsage = detailHasCanonical ? detail.chinaLinkUsage : readLegacyChinaLinkUsage(detail);
    const usagesMatch = rawHasCanonical
      ? isRecord(detail.chinaLinkUsage) && hash(detail.chinaLinkUsage) === hash(raw.chinaLinkUsage)
      : !detailHasCanonical && hash(detailUsage) === hash(rawUsage);
    const knownHistoricalWrite = !usagesMatch && !rawHasCanonical && !detailHasCanonical &&
      isVerifiedHistoricalPurchaseWrite(raw, detail, rawUsage, detailUsage);
    if (!Number.isFinite(rawDate) || !Number.isFinite(detailDate) || (!usagesMatch && !knownHistoricalWrite)) {
      throw new Error(`상품 상세에 아직 동기화되지 않은 변경이 있습니다. 상품 ID: ${itemId}`);
    }
    if (knownHistoricalWrite) recognizedHistoricalWrites++;
    if (usagesMatch && detailDate > rawDate) newerMatchingDetails++;
    guarded.push({
      ...entry,
      expectedNormalizedUpdatedAt: detail.updatedAt,
      expectedNormalizedLinkUsage: readChinaLinkUsage(detail),
    });
  }
  return { guarded, details, recognizedHistoricalWrites, newerMatchingDetails };
}

async function verifyDetailRead(query, batch, previousDetails) {
  const items = await readDetailBatch(query, batch);
  for (const entry of batch) {
    const current = items.get(entry.itemId);
    if (!matchesStoredUsage(current, entry.patch.chinaLinkUsage)) {
      throw new Error("실제 상품 상세 조회의 중국 링크가 저장한 값과 일치하지 않습니다.");
    }
    if (hash(withoutChinaLinkUsage(current)) !== hash(withoutChinaLinkUsage(previousDetails.get(entry.itemId)))) {
      throw new Error("상품 상세의 기존 데이터가 이관 이전과 일치하지 않습니다.");
    }
  }
}

export async function applyChinaLinkUsageBatches(query, patches, initial, onBatch = () => {}) {
  let before = initial;
  let normalizedBatches = 0;
  for (let offset = 0; offset < patches.length; offset += BATCH_SIZE) {
    const batch = patches.slice(offset, offset + BATCH_SIZE);
    const { guarded, details } = await verifyBeforeWrite(query, batch, before);
    const saved = await query("", {
      operation: "bulk_patch_items",
      expectedStateUpdatedAt: before.updatedAt,
      patches: guarded,
    });
    assertSamePatchIds(saved.changedIds, batch);
    const after = readSnapshot(await query("?mode=export"));
    if (after.updatedAt !== saved.updatedAt) {
      throw new Error("이관 저장 후 다른 변경이 발견되었습니다. 최신 상태로 미리보기를 다시 생성하세요.");
    }
    for (const entry of batch) {
      assertReadbackItem(after.items.get(entry.itemId), before.items.get(entry.itemId), entry.patch.chinaLinkUsage);
    }
    if (saved.normalizedSynced !== true) {
      throw new Error("원본 저장은 확인했으나 상품 상세 동기화가 실패했습니다. 영수증으로 진행 상태를 확인하세요.");
    }
    await verifyDetailRead(query, batch, details);
    normalizedBatches++;
    before = after;
    onBatch(Math.min(offset + BATCH_SIZE, patches.length), patches.length);
  }
  if (patches.length) {
    const final = readSnapshot(await query("?mode=export"));
    if (final.updatedAt !== before.updatedAt) {
      throw new Error("검증 완료 전에 상품 상태가 바뀌었습니다. 최신 상태로 미리보기를 다시 생성하세요.");
    }
    for (const entry of patches) {
      assertReadbackItem(final.items.get(entry.itemId), initial.items.get(entry.itemId), entry.patch.chinaLinkUsage);
    }
  }
  return { changed: patches.length, normalizedBatches };
}

export function makeChinaLinkUsageReceipt(origin, plan) {
  return {
    version: RECEIPT_VERSION,
    origin,
    digest: plan.digest,
    items: plan.patches.map(({ itemId, patch }) => ({
      itemId,
      migratedHash: hash(patch.chinaLinkUsage),
      originalHash: hash(plan.snapshot.items.get(itemId)),
    })),
  };
}

export function planChinaLinkUsageRollback(body, receipt, origin) {
  if (receipt?.version !== RECEIPT_VERSION || receipt.origin !== origin ||
      !Array.isArray(receipt.items) || !/^[a-f0-9]{64}$/.test(receipt.digest)) {
    throw new Error("이 환경에서 생성한 중국 링크 이관 영수증이 필요합니다.");
  }
  const snapshot = readSnapshot(body);
  const patches = [];
  const preservedChangedItemIds = [];
  const seen = new Set();
  for (const entry of receipt.items) {
    const itemId = text(entry?.itemId);
    if (!itemId || seen.has(itemId) || !/^[a-f0-9]{64}$/.test(entry.migratedHash) ||
        !/^[a-f0-9]{64}$/.test(entry.originalHash)) {
      throw new Error("이관 영수증에 잘못된 상품 기록이 있습니다.");
    }
    seen.add(itemId);
    const item = snapshot.items.get(itemId);
    if (!item || !ownsLinkUsage(item)) continue;
    const { chinaLinkUsage, ...otherFields } = item;
    if (hash(chinaLinkUsage) !== entry.migratedHash || hash(otherFields) !== entry.originalHash) {
      preservedChangedItemIds.push(itemId);
      continue;
    }
    patches.push(migrationPatch(item, null));
  }
  return { snapshot, patches, preservedChangedItemIds };
}

async function main(args) {
  const [mode = "--dry-run", ...options] = args;
  if (!["--dry-run", "--apply", "--rollback"].includes(mode)) {
    throw new Error("사용법: --dry-run | --apply <digest> --receipt <path> | --rollback --receipt <path>");
  }
  const digest = mode === "--apply" ? options.shift() : null;
  const receiptPath = options[0] === "--receipt" && options.length === 2 ? options[1] : "";
  if (mode === "--dry-run" ? options.length > 0 : !receiptPath) {
    throw new Error("적용과 복구에는 --receipt <path>가 필요합니다.");
  }
  const origin = checkOrigin(process.env.OPS_PRODUCT_LAUNCH_ORIGIN || DEFAULT_ORIGIN);
  const query = makeMigrationTransport(origin);
  const body = await query("?mode=export");
  if (mode === "--rollback") {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const plan = planChinaLinkUsageRollback(body, receipt, origin);
    const result = await applyChinaLinkUsageBatches(query, plan.patches, plan.snapshot, logBatch);
    console.log(JSON.stringify({ ...result, preservedChanged: plan.preservedChangedItemIds.length }));
    return;
  }
  const plan = planChinaLinkUsageMigration(body);
  if (mode === "--dry-run") {
    let recognizedHistoricalWrites = 0;
    let newerMatchingDetails = 0;
    for (let offset = 0; offset < plan.patches.length; offset += BATCH_SIZE) {
      const proof = await verifyBeforeWrite(query, plan.patches.slice(offset, offset + BATCH_SIZE), plan.snapshot);
      recognizedHistoricalWrites += proof.recognizedHistoricalWrites;
      newerMatchingDetails += proof.newerMatchingDetails;
    }
    console.log(JSON.stringify({
      ...plan.report, candidates: plan.patches.length, recognizedHistoricalWrites, newerMatchingDetails, digest: plan.digest,
    }));
    return;
  }
  if (plan.digest !== digest) {
    throw new Error("미리보기 이후 상품 상태가 바뀌었습니다. 최신 미리보기 해시가 필요합니다.");
  }
  if (!plan.patches.length) {
    console.log(JSON.stringify({ changed: 0, ...plan.report }));
    return;
  }
  const receipt = makeChinaLinkUsageReceipt(origin, plan);
  await writeFile(receiptPath, JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
  const result = await applyChinaLinkUsageBatches(query, plan.patches, plan.snapshot, logBatch);
  console.log(JSON.stringify({ ...result, ...plan.report }));
}

function logBatch(done, total) {
  console.log(JSON.stringify({ verified: done, total }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
