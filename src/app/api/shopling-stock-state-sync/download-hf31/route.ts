import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf30Download } from "../download-hf30/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.5.8";
const VERSION = "0.5.9";
const HOTFIX = "HF31_A6_A21_ALL_DATE_EXACT_BCODE_LOOKUP";
const STOCK_WORKER = "content-shopling-v030.js";
const A21_WORKER = "content-a21-canonical-v014.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const RUN_A6_BEFORE = `  async function runA6(job) {
    if (role() !== "A6") return navigateTo("A6");
    const pageSize = setA6MaxPageSizeHF19();
    if (!pageSize.ok) return pageSize;
    await sleep(120);
    const search = await searchExact("옵션자체관리코드", job.barcode);`;

const RUN_A6_AFTER = `  function clearA6DateScopeHF31() {
    const form = document.forms?.frm || document.querySelector('form[action*="prodBulkOptLst"]');
    const start = form?.querySelector('input[name="s_dt"]');
    const end = form?.querySelector('input[name="e_dt"]');
    if (!(form instanceof HTMLFormElement) || !(start instanceof HTMLInputElement) || !(end instanceof HTMLInputElement)) {
      return { ok: false, code: "A6_DATE_SCOPE_CONTROLS_NOT_FOUND", message: "A6 전체기간 조회를 위한 등록일 범위 입력칸을 찾지 못했습니다." };
    }
    const previousDateRange = { start: start.value, end: end.value };
    for (const input of [start, end]) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (start.value !== "" || end.value !== "") {
      return { ok: false, code: "A6_DATE_SCOPE_CLEAR_FAILED", message: "A6 등록일 범위를 전체기간으로 변경하지 못했습니다.", evidence: { previousDateRange, currentDateRange: { start: start.value, end: end.value } } };
    }
    return { ok: true, dateScope: "ALL_DATES", previousDateRange };
  }

  async function runA6(job) {
    if (role() !== "A6") return navigateTo("A6");
    const pageSize = setA6MaxPageSizeHF19();
    if (!pageSize.ok) return pageSize;
    const dateScope = clearA6DateScopeHF31();
    if (!dateScope.ok) return dateScope;
    await sleep(120);
    const search = await searchExact("옵션자체관리코드", job.barcode);`;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf30Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[STOCK_WORKER];
  const a21Bytes = entries[A21_WORKER];
  if (!manifestBytes || !workerBytes || !a21Bytes) {
    throw new Error("shopling_stock_hf31_required_entry_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf31_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v072.js") {
    throw new Error("shopling_stock_hf31_hf30_checkpoint_missing");
  }

  let worker = strFromU8(workerBytes);
  for (const guard of [
    "setA6MaxPageSizeHF19",
    'searchExact("옵션자체관리코드", job.barcode)',
    'goodsKeySource: "A6_LIVE_OPTION_BARCODE"',
    "A6_RESULT_PAGE_INCOMPLETE",
  ]) {
    if (!worker.includes(guard)) {
      throw new Error(`shopling_stock_hf31_worker_guard_missing:${guard}`);
    }
  }
  worker = replaceOnce(
    worker,
    RUN_A6_BEFORE,
    RUN_A6_AFTER,
    "shopling_stock_hf31_a6_all_date_scope",
  );
  new Function(worker);
  entries[STOCK_WORKER] = strToU8(worker);

  let a21Worker = strFromU8(a21Bytes);
  if (!a21Worker.includes("if (!enableAllDateSearch())")) {
    throw new Error("shopling_stock_hf31_a21_all_date_call_missing");
  }
  if (!a21Worker.includes("function enableAllDateSearch()")) {
    a21Worker = replaceOnce(
      a21Worker,
      "  function findSearchInput() {",
      `  function enableAllDateSearch() {
    const checkbox = document.querySelector('#all_srch_no_term_btn, input[name="all_srch_no_term_btn"]');
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox" || !visible(checkbox)) return false;
    return setControl(checkbox, true) && checkbox.checked === true;
  }

  function findSearchInput() {`,
      "shopling_stock_hf31_a21_all_date_function",
    );
  }
  new Function(a21Worker);
  entries[A21_WORKER] = strToU8(a21Worker);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF31";
  manifest.description =
    "HF31 clears the A6 registration-date range before every exact option B-code lookup and restores the required A21 all-date checkbox guard. Older Shopling products are included, while exact B-code row binding, full-result verification, and batched A21 transmission remain fail-closed.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF31`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf31_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  const a21WorkerSha256 = createHash("sha256").update(a21Worker).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        a6DateScope: "ALL_DATES",
        a21DateScope: "ALL_DATES",
        a21AllDateGuardRestored: true,
        a6SearchField: "옵션자체관리코드",
        a6ExactBcodeRowsRequired: true,
        a6FullResultVerificationPreserved: true,
        hf30OptionBatchAndParallelGuardsPreserved: true,
        worker: STOCK_WORKER,
        workerSha256,
        a21Worker: A21_WORKER,
        a21WorkerSha256,
        liveShoplingA6AllDateVerified: false,
        liveShoplingA21AllDateVerified: false,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf31.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-a6-date-scope": "ALL_DATES",
      "x-stock-a21-date-scope": "ALL_DATES",
      "x-stock-worker-sha256": workerSha256,
      "x-stock-a21-worker-sha256": a21WorkerSha256,
    },
  });
}

