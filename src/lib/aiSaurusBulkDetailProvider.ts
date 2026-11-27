import { createHash } from "node:crypto";
import { acceptSaurusHostedReceipt, object } from "./aiSaurusBulkDetailCore";
import type { AiSaurusBatchProduct, AiSaurusDetailBatch } from "./aiSaurusBulkDetailTypes";
import {
  canonicalOpsOffer, OPS_SAURUS_CONTRACT, OPS_SAURUS_PRODUCTION, OPS_SAURUS_STATUS_PATH,
  opsDetailSecret, signOpsDispatch, type OpsDetailDispatch,
} from "./opsDetailDispatch";

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BROWSER_WINDOW_MS = 90 * 60_000;

async function productionJson(path: string, init: RequestInit = {}) {
  const response = await fetch(OPS_SAURUS_PRODUCTION + path, {
    ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error("AI 사우루스 운영 연결을 확인하지 못했습니다.");
  return object(await response.json());
}

export async function readOpsSaurusRelease() {
  const [contract, manifest] = await Promise.all([
    productionJson(OPS_SAURUS_STATUS_PATH), productionJson("/extension/manifest.json"),
  ]);
  if (contract.contract !== OPS_SAURUS_CONTRACT || contract.enabled !== true ||
      typeof contract.deployment !== "string" || !/^[a-f0-9]{40}$/.test(contract.deployment) ||
      typeof contract.engine !== "string" || !contract.engine ||
      typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
      contract.importer !== manifest.version || !Number.isSafeInteger(contract.credits) || Number(contract.credits) <= 0)
    throw new Error("운영 엔진과 최신 1688 확장의 버전 정보를 확인해 주세요.");
  return {
    deployment: contract.deployment, engine: contract.engine, importer: manifest.version, maxCredits: Number(contract.credits),
  };
}

export function dispatchClaims(product: AiSaurusBatchProduct, expires: number): OpsDetailDispatch {
  if (!product.dispatch) throw new Error("AI 사우루스 요청을 찾지 못했습니다.");
  const source = canonicalOpsOffer(product.sourceUrl);
  if (!source) throw new Error("제작용 1688 링크를 확인해 주세요.");
  return {
    attempt: product.dispatch.attempt, inputHash: product.inputHash, source,
    name: product.name, options: product.options, email: product.dispatch.email,
    importer: product.dispatch.importer, deployment: product.dispatch.deployment, maxCredits: product.dispatch.maxCredits, expires,
  };
}

export function browserLaunchUrl(product: AiSaurusBatchProduct, now = Date.now()) {
  if (!product.dispatch || product.dispatch.providerJobId) throw new Error("이미 제작을 시작한 상품입니다.");
  const expires = Date.parse(product.dispatch.startedAt) + BROWSER_WINDOW_MS;
  if (expires <= now) throw new Error("제작 창이 만료되었습니다. 작업 상태를 먼저 새로고침해 주세요.");
  const launch = new URL("/kr/app", OPS_SAURUS_PRODUCTION);
  const claims = dispatchClaims(product, expires);
  launch.searchParams.set("source_link", claims.source);
  launch.searchParams.set("ops", claims.attempt);
  launch.hash = new URLSearchParams({ ops_detail: signOpsDispatch(claims, opsDetailSecret()) }).toString();
  return launch.toString();
}

export async function readOpsSaurusStatus(product: AiSaurusBatchProduct, now = Date.now()) {
  const payload = dispatchClaims(product, now + 5 * 60_000);
  return productionJson(OPS_SAURUS_STATUS_PATH, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", dispatch: signOpsDispatch(payload, opsDetailSecret()) }),
  });
}

export function startOpsSaurusProduct(
  batch: AiSaurusDetailBatch, id: string, email: string, now: string,
  release: Awaited<ReturnType<typeof readOpsSaurusRelease>>,
) {
  const product = batch.products.find((row) => row.id === id);
  if (!product || product.stage !== "waiting_connection" || product.attempts >= 2 ||
      batch.products.some((row) => row.stage === "running")) {
    throw new Error("현재 제작 중인 상품을 마치고 준비된 상품을 선택해 주세요.");
  }
  const attempt = createHash("sha256")
    .update(JSON.stringify([OPS_SAURUS_CONTRACT, batch.id, product.id, product.inputHash, product.attempts + 1]))
    .digest("hex");
  const next: AiSaurusBatchProduct = {
    ...product, stage: "running", attempts: product.attempts + 1, error: undefined,
    dispatch: { attempt, email, importer: release.importer, deployment: release.deployment, maxCredits: release.maxCredits, startedAt: now },
    run: undefined, receipt: undefined,
  };
  return { batch: replaceProduct(batch, next, now), product: next };
}

export function replaceProduct(batch: AiSaurusDetailBatch, product: AiSaurusBatchProduct, now: string) {
  return { ...batch, revision: batch.revision + 1, updatedAt: now,
    products: batch.products.map((row) => row.id === product.id ? product : row) };
}

export function reconcileOpsSaurusStatus(product: AiSaurusBatchProduct, state: Record<string, unknown>, now: number): AiSaurusBatchProduct {
  if (!product.dispatch || product.stage !== "running") return product;
  const dispatch = product.dispatch;
  if (state.state === "collecting") {
    if (!dispatch.providerJobId && Date.parse(dispatch.startedAt) + BROWSER_WINDOW_MS + 60_000 <= now) {
      return { ...product, stage: "failed", error: "제작 요청 시간이 지났습니다. 이 시도에서 사용된 크레딧은 없습니다." };
    }
    return product;
  }
  if (typeof state.providerJobId !== "string" || !ID.test(state.providerJobId) ||
      (dispatch.providerJobId && dispatch.providerJobId !== state.providerJobId) ||
      typeof state.engine !== "string" || !state.engine) throw new Error("AI 사우루스 작업 식별 정보가 일치하지 않습니다.");
  const next = { ...product, dispatch: { ...dispatch, providerJobId: state.providerJobId } };
  if (state.state === "running") {
    const progress = Math.min(99, Math.max(0, Number(state.progress) || 0));
    return dispatch.progress === progress && dispatch.providerJobId ? product : { ...next, dispatch: { ...next.dispatch, progress } };
  }
  if (!Number.isSafeInteger(state.creditCost) || Number(state.creditCost) < 0 ||
      Number(state.creditCost) > dispatch.maxCredits || typeof state.costReceiptId !== "string" || !state.costReceiptId)
    throw new Error("AI 사우루스 비용을 확인하지 못했습니다.");
  if (state.state === "failed") return { ...next, stage: "failed", error: String(state.message ?? "AI 사우루스 제작에 실패했습니다.") };
  const { hostedUrl, qa, assetId, sha256 } = state;
  if (state.state !== "succeeded" || qa !== "passed" || typeof assetId !== "string" || !ID.test(assetId) ||
      hostedUrl !== `${OPS_SAURUS_PRODUCTION}/api/saas/marketplace-assets/${assetId}/image.jpg` ||
      typeof sha256 !== "string" || !SHA.test(sha256)) throw new Error("AI 사우루스 최종 호스팅 결과를 확인하지 못했습니다.");
  const credits = Number(state.creditCost);
  return acceptSaurusHostedReceipt({
    ...next,
    run: {
      attemptKey: dispatch.attempt, inputHash: product.inputHash, sessionEvidenceId: state.providerJobId,
      release: { origin: OPS_SAURUS_PRODUCTION, deploymentId: dispatch.deployment, engineVersion: state.engine,
        importerVersion: dispatch.importer, contractVersion: OPS_SAURUS_CONTRACT, hostingOrigins: [OPS_SAURUS_PRODUCTION] },
      approvedBudgetMinor: dispatch.maxCredits, currency: "CRD",
    },
  }, {
    attemptKey: dispatch.attempt, inputHash: product.inputHash, itemId: product.id, deploymentId: dispatch.deployment,
    sessionEvidenceId: state.providerJobId, providerJobId: state.providerJobId, hostedImageUrl: hostedUrl,
    sha256, qa, transferReceiptId: assetId, costReceiptId: state.costReceiptId, costMinor: credits, currency: "CRD",
  });
}
