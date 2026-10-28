import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf32Download } from "../download-hf32/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.0";
const VERSION = "0.6.1";
const HOTFIX = "HF33_A6_2022_RANGE_AND_ROW_IDENTITY";
const STOCK_WORKER = "content-shopling-v030.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function ensureInputAwareMatchingRows(worker: string) {
  if (worker.includes("function rowEvidenceTextV053(")) {
    return worker;
  }
  return replaceOnce(
    worker,
    MATCHING_ROWS_BEFORE,
    MATCHING_ROWS_AFTER,
    "shopling_stock_hf33_exact_input_evidence",
  );
}

const DATE_SCOPE_BEFORE = `  function clearA6DateScopeHF31() {
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
  }`;

const DATE_SCOPE_AFTER = `  function clearA6DateScopeHF31() {
    const form = document.forms?.frm || document.querySelector('form[action*="prodBulkOptLst"]');
    const start = form?.querySelector('input[name="s_dt"]');
    const end = form?.querySelector('input[name="e_dt"]');
    if (!(form instanceof HTMLFormElement) || !(start instanceof HTMLInputElement) || !(end instanceof HTMLInputElement)) {
      return { ok: false, code: "A6_DATE_SCOPE_CONTROLS_NOT_FOUND", message: "A6 상품등록기간 입력칸(s_dt/e_dt)을 찾지 못했습니다." };
    }
    const previousDateRange = { start: start.value, end: end.value };
    const todayKst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
    const expectedDateRange = { start: "20220101", end: todayKst };
    for (const [input, value] of [[start, expectedDateRange.start], [end, expectedDateRange.end]]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const currentDateRange = { start: start.value, end: end.value };
    if (currentDateRange.start !== expectedDateRange.start || currentDateRange.end !== expectedDateRange.end) {
      return { ok: false, code: "A6_DATE_SCOPE_SET_FAILED", message: "A6 상품등록기간을 2022-01-01부터 오늘까지 설정하지 못했습니다.", evidence: { previousDateRange, expectedDateRange, currentDateRange } };
    }
    return { ok: true, dateScope: "2022_TO_TODAY", previousDateRange, currentDateRange };
  }`;

const ROWS_BEFORE = `  function a6RowsFromDocumentHF19(doc, barcode) {
    const barcodeRegex = exactTokenRegex(barcode);
    return [...doc.querySelectorAll("tr")]
      .map((row) => ({ row, text: a6RowEvidenceTextHF19(row) }))
      .filter(({ text }) => barcodeRegex.test(text.toUpperCase()) && /(^|[^0-9])\\d{4,}-\\d{4,}(?=[^0-9]|$)/.test(text));
  }`;

const ROWS_AFTER = `  function a6IdentityPairHF33(row, text) {
    const checkbox = row?.querySelector?.('input[name="chk[]"]') || row?.querySelector?.('input[type="checkbox"][value*="_"]');
    const checkboxValue = String(checkbox?.value || "").trim();
    const checkboxMatch = checkboxValue.match(/^(\\d{4,})_(\\d{4,})$/);
    if (checkboxMatch) return { goodsKey: checkboxMatch[1], optionId: checkboxMatch[2], source: "CHECKBOX_VALUE" };
    const textMatch = String(text || "").match(/(^|[^0-9])(\\d{4,})-(\\d{4,})(?=[^0-9]|$)/);
    return textMatch ? { goodsKey: textMatch[2], optionId: textMatch[3], source: "ROW_TEXT" } : null;
  }

  function a6RowsFromDocumentHF19(doc, barcode) {
    const barcodeRegex = exactTokenRegex(barcode);
    return [...doc.querySelectorAll("tr")]
      .map((row) => ({ row, text: a6RowEvidenceTextHF19(row) }))
      .filter(({ text }) => barcodeRegex.test(text.toUpperCase()));
  }`;

const PAIRS_BEFORE = `    const pairRegex = /(^|[^0-9])(\\d{4,})-(\\d{4,})(?=[^0-9]|$)/g;
    const discoveredPairs = [];
    for (const entry of resultRows) {
      for (const match of entry.text.matchAll(pairRegex)) {
        discoveredPairs.push({ goodsKey: match[2], optionId: match[3], rowText: entry.text.slice(0, 500) });
      }
    }`;

const PAIRS_AFTER = `    const discoveredPairs = [];
    for (const entry of resultRows) {
      const pair = a6IdentityPairHF33(entry.row, entry.text);
      if (pair) discoveredPairs.push({ ...pair, rowText: entry.text.slice(0, 500) });
    }`;

const MATCHING_ROWS_BEFORE = `  function matchingRows(token) {
    const regex = exactTokenRegex(token);
    return [...document.querySelectorAll("tr")]
      .filter((row) => visible(row) && regex.test(norm(row.textContent).toUpperCase()))
      .map((row) => ({ row, checkbox: row.querySelector('input[type="checkbox"]'), text: norm(row.textContent) }))
      .filter((entry) => entry.checkbox && !entry.checkbox.disabled);
  }`;

const MATCHING_ROWS_AFTER = `  function rowEvidenceTextHF33(row) {
    const values = [row?.textContent || ""];
    for (const control of row?.querySelectorAll?.("input,textarea,select") || []) {
      if ("value" in control) values.push(control.value || "");
      if (control instanceof HTMLSelectElement) values.push(control.options?.[control.selectedIndex]?.textContent || "");
    }
    return norm(values.join(" "));
  }

  function matchingRows(token) {
    const regex = exactTokenRegex(token);
    return [...document.querySelectorAll("tr")]
      .map((row) => ({ row, text: rowEvidenceTextHF33(row) }))
      .filter((entry) => visible(entry.row) && regex.test(entry.text.toUpperCase()))
      .map((entry) => ({ ...entry, checkbox: entry.row.querySelector('input[type="checkbox"]') }))
      .filter((entry) => entry.checkbox && !entry.checkbox.disabled);
  }`;

const RESULT_ROWS_BEFORE = `    const resultRows = collected.rows;
    if (Number.isInteger(totalResultCount) && totalResultCount > 0 && resultRows.length !== totalResultCount) {
      return { ok: false, code: "A6_RESULT_PAGE_INCOMPLETE", message: String(job.barcode) + " A6 조회 " + totalResultCount + "건 중 상품코드 행 " + resultRows.length + "건만 읽혀 일부 누락 위험 때문에 중단했습니다.", evidence: { totalResultCount, matchedRows: resultRows.length, pageSize: pageSize.pageSize, pagesRead: collected.pages, readOnly: true } };
    }`;

const RESULT_ROWS_AFTER = `    const allResultRows = collected.rows;
    if (Number.isInteger(totalResultCount) && totalResultCount > 0 && allResultRows.length !== totalResultCount) {
      return { ok: false, code: "A6_RESULT_PAGE_INCOMPLETE", message: String(job.barcode) + " A6 조회 " + totalResultCount + "건 중 상품코드 행 " + allResultRows.length + "건만 읽혀 일부 누락 위험 때문에 중단했습니다.", evidence: { totalResultCount, matchedRows: allResultRows.length, pageSize: pageSize.pageSize, pagesRead: collected.pages, readOnly: true } };
    }
    const resultRows = allResultRows;
`;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf32Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[STOCK_WORKER];
  if (!manifestBytes || !workerBytes) {
    throw new Error("shopling_stock_hf33_required_entry_missing");
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
    throw new Error("shopling_stock_hf33_manifest_version_mismatch");
  }

  let worker = strFromU8(workerBytes);
  worker = replaceOnce(
    worker,
    DATE_SCOPE_BEFORE,
    DATE_SCOPE_AFTER,
    "shopling_stock_hf33_a6_date_scope",
  );
  worker = ensureInputAwareMatchingRows(worker);
  worker = replaceOnce(
    worker,
    ROWS_BEFORE,
    ROWS_AFTER,
    "shopling_stock_hf33_a6_row_identity",
  );
  worker = replaceOnce(
    worker,
    PAIRS_BEFORE,
    PAIRS_AFTER,
    "shopling_stock_hf33_a6_pair_identity",
  );
  worker = replaceOnce(
    worker,
    RESULT_ROWS_BEFORE,
    RESULT_ROWS_AFTER,
    "shopling_stock_hf33_a6_goods_key_binding",
  );
  worker = replaceOnce(
    worker,
    'String(job.barcode) + " 검색결과에서 상품코드가 있는 정확 행을 찾지 못했습니다."',
    'String(job.barcode) + "를 2022-01-01~오늘 범위에서 검색했지만 정확히 연결된 상품 행을 찾지 못했습니다."',
    "shopling_stock_hf33_a6_not_found_message",
  );
  new Function(worker);
  entries[STOCK_WORKER] = strToU8(worker);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF33";
  manifest.description =
    "HF33 searches A6 from 2022-01-01 through today, discovers every goods key under the exact B-code, and sends only that exact option for each goods key.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF33`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf33_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        a6RegistrationDateStart: "20220101",
        a6RegistrationDateEnd: "TODAY_KST",
        a6DateControls: ["s_dt", "e_dt"],
        a6GoodsIdentitySources: ["CHECKBOX_VALUE", "ROW_TEXT"],
        exactSearchEvidenceSources: ["ROW_TEXT", "INPUT_VALUE"],
        a6ExactBcodeRowsRequired: true,
        a21AllDateGuardPreserved: true,
        warehouseBridgePreserved: true,
        liveShoplingVerificationRequired: true,
        worker: STOCK_WORKER,
        workerSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf33.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-a6-registration-date-start": "20220101",
      "x-stock-worker-sha256": workerSha256,
    },
  });
}
