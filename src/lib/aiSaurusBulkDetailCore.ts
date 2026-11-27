import { createHash } from "node:crypto";
import { readChinaDetailPageLink } from "../../public/product-launch-tracker-app/lib/china-product-links.mjs";
import {
  AI_SAURUS_BULK_LIMIT, AI_SAURUS_ORIGIN,
  type AiSaurusBatchProduct, type AiSaurusDetailBatch, type AiSaurusHostedReceipt,
  type AiSaurusRelease,
} from "./aiSaurusBulkDetailTypes.ts";

type Item = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
const MAX_ATTEMPTS = 2;

export function object(value: unknown): Item {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Item : {};
}

function text(value: unknown, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseSaurusSelection(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_SAURUS_BULK_LIMIT) {
    throw new Error(`상품을 1~${AI_SAURUS_BULK_LIMIT}개 선택해 주세요.`);
  }
  const ids = value.map((id) => text(id, 181));
  if (ids.some((id) => !/^[a-z0-9][a-z0-9._:-]{0,179}$/i.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("선택 상품 ID가 비어 있거나 중복되었습니다.");
  }
  return ids;
}

export function saurusSelectionHash(ids: string[]) {
  return digest(["ai-saurus-detail", 1, [...ids].sort()]);
}

export function parseSaurusOptions(value: unknown) {
  if (!Array.isArray(value) || value.length > 80 ||
      value.some((option) => typeof option !== "string" || option.trim().length > 100)) {
    throw new Error("옵션은 최대 80개이며 한 옵션은 100자 이하로 입력해 주세요.");
  }
  return [...new Set(value.map((option) => text(option, 100)).filter(Boolean))];
}

function currentImage(item: Item) {
  return text(object(item.detailPageAsset).detailImageUrl, 4000);
}

function productInputHash(product: AiSaurusBatchProduct) {
  return digest(["ai-saurus-detail", 1, product.id, product.sourceUrl, product.name, product.options]);
}

function is1688ProductUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://detail.1688.com" && !url.username && !url.password &&
      /^\/offer\/\d+\.html$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function newSaurusBatch(id: string, ids: string[], sourceItems: Item[], now: string): AiSaurusDetailBatch {
  const byId = new Map(sourceItems.map((item) => [item.id, item]));
  const selection = parseSaurusSelection(ids);
  const products = selection.map((itemId): AiSaurusBatchProduct => {
    const item = byId.get(itemId);
    if (!item || item.archivedAt) throw new Error("선택한 상품을 모두 확인하지 못했습니다. 목록을 새로고침해 주세요.");
    const catalogOptions = [...new Set((Array.isArray(item.orderOptions) ? item.orderOptions : [])
      .map((option) => {
        const row = object(option);
        return text(row.saleOption ?? row.value, 100);
      }).filter(Boolean))].slice(0, 80);
    const product: AiSaurusBatchProduct = {
      id: itemId, model: text(item.modelNumber), name: text(item.productName),
      sourceUrl: readChinaDetailPageLink(item), originalDetailImageUrl: currentImage(item),
      catalogOptions, options: catalogOptions, stage: "draft", attempts: 0, inputHash: "",
    };
    return { ...product, inputHash: productInputHash(product) };
  });
  return { id, revision: 0, createdAt: now, updatedAt: now, selectionHash: saurusSelectionHash(selection), products };
}

export function updateSaurusPreparation(batch: AiSaurusDetailBatch, edits: unknown, prepare: boolean, now: string) {
  if (!Array.isArray(edits)) throw new Error("선택한 상품의 옵션을 확인해 주세요.");
  const ids = parseSaurusSelection(edits.map((entry) => object(entry).id));
  const byId = new Map(batch.products.map((product) => [product.id, product]));
  const updates = new Map(edits.map((entry, index) => [ids[index], parseSaurusOptions(object(entry).options)]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || batch.queuedIds?.includes(id) || (row.stage !== "draft" && row.stage !== "waiting_connection")) {
      throw new Error("준비 중인 상품만 편집할 수 있습니다.");
    }
    if (prepare && (!updates.get(id)?.length || !is1688ProductUrl(row.sourceUrl))) {
      throw new Error(`${row.model || row.name || id}의 제작용 1688 링크와 옵션명을 확인해 주세요.`);
    }
  }
  return {
    ...batch, revision: batch.revision + 1, updatedAt: now,
    products: batch.products.map((product): AiSaurusBatchProduct => {
      const options = updates.get(product.id);
      if (!options) return product;
      const next: AiSaurusBatchProduct = { ...product, options, stage: prepare ? "waiting_connection" : "draft" };
      return { ...next, inputHash: productInputHash(next) };
    }),
  };
}

export function refreshSaurusPreparation(batch: AiSaurusDetailBatch, fresh: AiSaurusDetailBatch) {
  const byId = new Map(fresh.products.map((product) => [product.id, product]));
  const products = batch.products.map((product) => {
    const current = byId.get(product.id);
    if (!current || batch.queuedIds?.includes(product.id) || !["draft", "waiting_connection"].includes(product.stage) ||
        (current.sourceUrl === product.sourceUrl && current.name === product.name && current.model === product.model &&
        current.originalDetailImageUrl === product.originalDetailImageUrl &&
        JSON.stringify(current.catalogOptions) === JSON.stringify(product.catalogOptions))) return product;
    const options = JSON.stringify(product.options) === JSON.stringify(product.catalogOptions)
      ? current.options : product.options;
    const next = { ...current, options };
    return { ...next, inputHash: productInputHash(next) };
  });
  return products.every((product, index) => product === batch.products[index]) ? batch
    : { ...batch, products, updatedAt: fresh.updatedAt, revision: batch.revision + 1 };
}

function latestImporter(installed: string, latest: string) {
  if (!SEMVER.test(installed) || !SEMVER.test(latest)) return false;
  const actual = installed.split(".").map(Number);
  const target = latest.split(".").map(Number);
  for (const [i, version] of actual.entries()) {
    if (version !== target[i]) return version > target[i];
  }
  return true;
}

type Saurus1688Session = { loggedIn: boolean; evidenceId: string; importerVersion: string; sourceOrigin: string };
type SaurusRunLimits = { approvedBudgetMinor: number; currency: string };
type SaurusRunChecks = {
  readProductionRelease: (request: { origin: typeof AI_SAURUS_ORIGIN; cache: "no-store" }) => Promise<AiSaurusRelease>;
  readOperator1688Session: (request: { sourceUrl: string; release: AiSaurusRelease }) => Promise<Saurus1688Session>;
};

// The real release and browser checks will be provided by the future authenticated connector.
export async function planSaurusRun(
  batchId: string, product: AiSaurusBatchProduct, currentItem: Item,
  checks: SaurusRunChecks, limits: SaurusRunLimits,
) {
  if (!["waiting_connection", "waiting_1688_login"].includes(product.stage) ||
      product.attempts >= MAX_ATTEMPTS || product.inputHash !== productInputHash(product) ||
      product.id !== currentItem.id || currentItem.archivedAt ||
      product.sourceUrl !== readChinaDetailPageLink(currentItem) || product.name !== text(currentItem.productName) ||
      !product.options.length || !is1688ProductUrl(product.sourceUrl)) {
    throw new Error("제작 입력이 변경됐거나 실행할 수 없는 상태입니다.");
  }
  const release = await checks.readProductionRelease({ origin: AI_SAURUS_ORIGIN, cache: "no-store" });
  if (release.origin !== AI_SAURUS_ORIGIN || !release.deploymentId || !release.engineVersion ||
      !SEMVER.test(release.importerVersion) || release.contractVersion !== "detail-hosting-v1" ||
      release.hostingOrigins.length === 0 || !Number.isSafeInteger(limits.approvedBudgetMinor) ||
      limits.approvedBudgetMinor < 0 || !/^[A-Z]{3}$/.test(limits.currency)) {
    throw new Error("운영 릴리스 또는 승인 예산을 확인하지 못했습니다.");
  }
  const session = await checks.readOperator1688Session({ sourceUrl: product.sourceUrl, release });
  if (!session.loggedIn || !session.evidenceId || session.sourceOrigin !== "https://detail.1688.com" ||
      !latestImporter(session.importerVersion, release.importerVersion)) {
    return { ...product, stage: "waiting_1688_login" as const, error: "동일한 Chrome의 1688 로그인과 최신 Importer 확인이 필요합니다." };
  }
  const attempts = product.attempts + 1;
  const attemptKey = digest([batchId, product.id, product.inputHash, attempts, release.deploymentId]);
  return {
    ...product, attempts, stage: "running" as const, error: undefined,
    run: { attemptKey, inputHash: product.inputHash, release, sessionEvidenceId: session.evidenceId, ...limits },
  };
}

export function acceptSaurusHostedReceipt(product: AiSaurusBatchProduct, receipt: AiSaurusHostedReceipt): AiSaurusBatchProduct {
  return { ...product, receipt: validateSaurusHostedReceipt(product, receipt), stage: "awaiting_review" };
}

export function planSaurusRetry(batch: AiSaurusDetailBatch, chosen: unknown, reconciledFailureKeys: ReadonlySet<string>, now: string) {
  const ids = new Set(parseSaurusSelection(chosen));
  const selected = batch.products.filter((product) => ids.has(product.id));
  if (selected.length !== ids.size || selected.some((product) =>
    product.stage !== "failed" || !product.run || product.attempts >= MAX_ATTEMPTS ||
    !reconciledFailureKeys.has(product.run.attemptKey))) {
    throw new Error("실패와 비용 처리 여부가 확인된 상품만 다시 준비할 수 있습니다.");
  }
  return {
    ...batch, revision: batch.revision + 1, updatedAt: now,
    products: batch.products.map((product): AiSaurusBatchProduct => ids.has(product.id)
      ? { ...product, stage: "waiting_connection", error: undefined }
      : product),
  };
}

function validateSaurusHostedReceipt(product: AiSaurusBatchProduct, receipt: AiSaurusHostedReceipt) {
  const { run } = product;
  const url = URL.parse(receipt.hostedImageUrl);
  if (product.stage !== "running" || !run ||
      receipt.attemptKey !== run.attemptKey || receipt.inputHash !== productInputHash(product) ||
      receipt.itemId !== product.id || receipt.deploymentId !== run.release.deploymentId ||
      receipt.sessionEvidenceId !== run.sessionEvidenceId ||
      receipt.qa !== "passed" || !HASH.test(receipt.sha256) ||
      !receipt.providerJobId || !receipt.transferReceiptId || !receipt.costReceiptId ||
      receipt.currency !== run.currency || !Number.isSafeInteger(receipt.costMinor) ||
      receipt.costMinor < 0 || receipt.costMinor > run.approvedBudgetMinor ||
      !url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname === "/" || !run.release.hostingOrigins.includes(url.origin)) {
    throw new Error("검수·호스팅·비용 영수증 또는 실행 식별 정보가 일치하지 않습니다.");
  }
  return receipt;
}

export function planSaurusApproval(batch: AiSaurusDetailBatch, chosen: unknown, launchItems: Item[]) {
  const ids = parseSaurusSelection(chosen);
  const updates = new Map<string, string>();
  const providerJobs = new Set<string>();
  const costReceipts = new Set<string>();
  for (const id of ids) {
    const product = batch.products.find((row) => row.id === id);
    const item = launchItems.find((row) => row.id === id);
    if (!product?.receipt || !item || item.archivedAt ||
        !["awaiting_review", "approved"].includes(product.stage) || product.inputHash !== productInputHash(product) ||
        product.sourceUrl !== readChinaDetailPageLink(item) || product.name !== text(item.productName)) {
      throw new Error("현재 상품과 일치하는 검수 통과 결과만 승인할 수 있습니다.");
    }
    const { hostedImageUrl, providerJobId, costReceiptId } = validateSaurusHostedReceipt({ ...product, stage: "running" }, product.receipt);
    if (providerJobs.has(providerJobId) || costReceipts.has(costReceiptId)) {
      throw new Error("여러 상품에 같은 제작 작업 또는 비용 영수증이 연결되어 있습니다.");
    }
    providerJobs.add(providerJobId);
    costReceipts.add(costReceiptId);
    const current = currentImage(item);
    if (current === hostedImageUrl) continue;
    if (product.stage !== "awaiting_review" || current !== product.originalDetailImageUrl) {
      throw new Error("기존 상세페이지 이미지 URL이 변경됐습니다. 최신 값을 먼저 확인해 주세요.");
    }
    updates.set(id, hostedImageUrl);
  }
  return launchItems.map((item) => {
    const url = updates.get(String(item.id));
    return url ? { ...item, detailPageAsset: { ...object(item.detailPageAsset), detailImageUrl: url } } : item;
  });
}

export function confirmSaurusApprovalReadback(batch: AiSaurusDetailBatch, chosen: unknown, savedItems: Item[], now: string) {
  const ids = new Set(parseSaurusSelection(chosen));
  const expected = planSaurusApproval(batch, chosen, savedItems);
  if (expected.some((item, index) => item !== savedItems[index])) {
    throw new Error("저장된 상세페이지 이미지 URL을 다시 확인하지 못했습니다.");
  }
  return {
    ...batch, revision: batch.revision + 1, updatedAt: now,
    products: batch.products.map((product): AiSaurusBatchProduct => ids.has(product.id)
      ? { ...product, stage: "approved" }
      : product),
  };
}
