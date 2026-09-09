import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf18Download } from "../download-hf18/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF19_A6_MAX_PAGINATION_A21_200_ACK_BEFORE_AUTOCLOSE";
const BACKGROUND_NEW = "background-v060.js";
const CANONICAL_LIST = "content-a21-canonical-v014.js";
const STOCK_WORKER = "content-shopling-v030.js";
const CONTENT_OPS = "content-ops-v021.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceSegment(source: string, start: string, end: string, replacement: string, code: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) throw new Error(`${code}:segment_missing`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

const A6_REPLACEMENT = `  function a6ControlTextHF19(element) {
    if (!element) return "";
    const values = [element.textContent, element.value, element.title, element.alt, element.name, element.id, element.getAttribute?.("aria-label")];
    for (const image of element.querySelectorAll?.("img[alt],img[title]") || []) values.push(image.getAttribute("alt") || "", image.getAttribute("title") || "");
    return norm(values.filter(Boolean).join(" "));
  }

  function setA6MaxPageSizeHF19() {
    const ranked = [...document.querySelectorAll("select")].map((select, index) => {
      const options = [...select.options].map((option) => ({ option, label: norm(option.textContent), value: Number(norm(option.textContent).replace(/[^0-9]/g, "")) }));
      const standardHits = options.filter((row) => [25, 50, 100, 200, 500, 1000].includes(row.value)).length;
      const context = norm(select.closest("tr")?.textContent || select.parentElement?.textContent || "");
      let score = standardHits * 80;
      if (/화면출력|출력수|페이지당|page\\s*size/i.test(context)) score += 600;
      if (standardHits < 2) score -= 800;
      const numeric = options.filter((row) => Number.isInteger(row.value) && row.value > 0 && row.value <= 5000);
      const maxValue = numeric.length ? Math.max(...numeric.map((row) => row.value)) : 0;
      return { select, options, maxValue, score, index };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    const candidate = ranked[0];
    if (!candidate || candidate.score < 200 || candidate.maxValue <= 0) {
      return { ok: false, code: "A6_MAX_PAGE_SIZE_NOT_FOUND", message: "A6 화면출력 드롭다운의 최대값을 안전하게 찾지 못했습니다." };
    }
    const target = candidate.options.find((row) => row.value === candidate.maxValue)?.option;
    if (!target) return { ok: false, code: "A6_MAX_PAGE_SIZE_OPTION_MISSING", message: "A6 최대 화면출력 옵션을 찾지 못했습니다." };
    if (candidate.select.value !== target.value) {
      candidate.select.value = target.value;
      candidate.select.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const selected = Number(norm(candidate.select.options?.[candidate.select.selectedIndex]?.textContent).replace(/[^0-9]/g, ""));
    return selected === candidate.maxValue
      ? { ok: true, pageSize: candidate.maxValue }
      : { ok: false, code: "A6_MAX_PAGE_SIZE_VERIFY_FAILED", message: "A6 최대 화면출력 설정이 유지되지 않았습니다.", evidence: { expected: candidate.maxValue, selected } };
  }

  function a6RowEvidenceTextHF19(row) {
    const values = [row?.textContent || ""];
    for (const control of row?.querySelectorAll?.("input,textarea,select") || []) {
      if ("value" in control) values.push(control.value || "");
      if (control instanceof HTMLSelectElement) values.push(control.options?.[control.selectedIndex]?.textContent || "");
    }
    return norm(values.join(" "));
  }

  function a6RowsFromDocumentHF19(doc, barcode) {
    const barcodeRegex = exactTokenRegex(barcode);
    return [...doc.querySelectorAll("tr")]
      .map((row) => ({ row, text: a6RowEvidenceTextHF19(row) }))
      .filter(({ text }) => barcodeRegex.test(text.toUpperCase()) && /(^|[^0-9])\\d{4,}-\\d{4,}(?=[^0-9]|$)/.test(text));
  }

  function a6TotalFromDocumentHF19(doc) {
    const text = norm(doc.body?.innerText || doc.body?.textContent || doc.documentElement?.textContent || "");
    const match = text.match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function a6NextPageHrefHF19(doc, nextPageNumber, baseHref) {
    const ranked = [];
    for (const anchor of doc.querySelectorAll("a[href]")) {
      const rawHref = String(anchor.getAttribute("href") || "").trim();
      if (!rawHref || rawHref === "#" || /^javascript:/i.test(rawHref)) continue;
      let url = null;
      try { url = new URL(rawHref, baseHref || location.href); } catch { continue; }
      if (url.origin !== location.origin || url.href === (baseHref || location.href)) continue;
      const label = norm([anchor.textContent, anchor.title, anchor.getAttribute("aria-label"), ...[...anchor.querySelectorAll("img[alt],img[title]")].flatMap((img) => [img.getAttribute("alt"), img.getAttribute("title")])].filter(Boolean).join(" "));
      const hrefEvidence = [url.pathname, url.search, anchor.getAttribute("onclick") || "", anchor.id || "", anchor.className || ""].join(" ");
      let score = 0;
      if (/^(다음|다음페이지|next|>|›|»|≫|▶)$/i.test(label)) score += 1000;
      if (/page|pageno|page_no|pageNum|pg=|curpage|nowpage/i.test(hrefEvidence)) score += 500;
      if (/^\\d+$/.test(label) && Number(label) === nextPageNumber) score += 700;
      if (/검색|수정|송신|상품명|goods/i.test(label)) score -= 1000;
      ranked.push({ href: url.href, score });
    }
    ranked.sort((left, right) => right.score - left.score);
    return ranked[0]?.score >= 900 ? ranked[0].href : null;
  }

  async function collectAllA6RowsHF19(job, firstRows, totalResultCount, pageSize) {
    if (!Number.isInteger(totalResultCount) || totalResultCount <= firstRows.length) return { ok: true, rows: firstRows, pages: 1 };
    const rows = [...firstRows];
    const visited = new Set([location.href]);
    const pageFingerprints = new Set([firstRows.map((entry) => entry.text).join("||")]);
    let currentDoc = document;
    let currentHref = location.href;
    let pageNumber = 1;
    while (rows.length < totalResultCount && pageNumber < 100) {
      const nextHref = a6NextPageHrefHF19(currentDoc, pageNumber + 1, currentHref);
      if (!nextHref || visited.has(nextHref)) {
        return { ok: false, code: "A6_PAGINATION_NEXT_NOT_FOUND", message: String(job.barcode) + " A6 조회 " + totalResultCount + "건 중 " + rows.length + "건을 읽은 뒤 다음 페이지 링크를 안전하게 특정하지 못했습니다. 부분처리는 하지 않습니다.", evidence: { totalResultCount, matchedRows: rows.length, pageSize, pagesRead: pageNumber, paginationRequired: true } };
      }
      visited.add(nextHref);
      const response = await fetch(nextHref, { method: "GET", credentials: "include", cache: "no-store" }).catch(() => null);
      if (!response?.ok) {
        return { ok: false, code: "A6_PAGINATION_FETCH_FAILED", message: String(job.barcode) + " A6 다음 페이지를 읽지 못했습니다. 부분처리는 하지 않습니다.", evidence: { nextHref, status: response?.status || null, totalResultCount, matchedRows: rows.length, pageSize, pagesRead: pageNumber } };
      }
      const html = await response.text();
      const nextDoc = new DOMParser().parseFromString(html, "text/html");
      const nextRows = a6RowsFromDocumentHF19(nextDoc, job.barcode);
      const nextTotal = a6TotalFromDocumentHF19(nextDoc);
      if (Number.isInteger(nextTotal) && nextTotal !== totalResultCount) {
        return { ok: false, code: "A6_PAGINATION_TOTAL_CHANGED", message: String(job.barcode) + " A6 페이지 이동 중 총 조회수가 변경되어 부분처리를 차단했습니다.", evidence: { expectedTotal: totalResultCount, nextTotal, nextHref, pagesRead: pageNumber } };
      }
      if (!nextRows.length) {
        return { ok: false, code: "A6_PAGINATION_EMPTY_PAGE", message: String(job.barcode) + " A6 다음 페이지에서 정확 B코드 행을 찾지 못해 부분처리를 차단했습니다.", evidence: { nextHref, totalResultCount, matchedRows: rows.length, pagesRead: pageNumber } };
      }
      const fingerprint = nextRows.map((entry) => entry.text).join("||");
      if (pageFingerprints.has(fingerprint)) {
        return { ok: false, code: "A6_PAGINATION_DUPLICATE_PAGE", message: String(job.barcode) + " A6 다음 페이지 응답이 이미 읽은 페이지와 같아 부분처리를 차단했습니다.", evidence: { nextHref, totalResultCount, matchedRows: rows.length, pagesRead: pageNumber } };
      }
      pageFingerprints.add(fingerprint);
      rows.push(...nextRows);
      pageNumber += 1;
      currentDoc = nextDoc;
      currentHref = nextHref;
      if (rows.length > totalResultCount) {
        return { ok: false, code: "A6_PAGINATION_ROW_OVERFLOW", message: String(job.barcode) + " A6 페이지 합산 행 수가 총 조회수보다 커져 부분처리를 차단했습니다.", evidence: { totalResultCount, matchedRows: rows.length, pagesRead: pageNumber } };
      }
    }
    if (rows.length !== totalResultCount) {
      return { ok: false, code: "A6_PAGINATION_INCOMPLETE", message: String(job.barcode) + " A6 전체 페이지 수집이 완료되지 않아 부분처리를 차단했습니다.", evidence: { totalResultCount, matchedRows: rows.length, pageSize, pagesRead: pageNumber } };
    }
    return { ok: true, rows, pages: pageNumber };
  }

  async function runA6(job) {
    if (role() !== "A6") return navigateTo("A6");
    const pageSize = setA6MaxPageSizeHF19();
    if (!pageSize.ok) return pageSize;
    await sleep(120);
    const search = await searchExact("옵션자체관리코드", job.barcode);
    if (!search.ok) return search;

    const firstRows = a6RowsFromDocumentHF19(document, job.barcode);
    const totalResultCount = a6TotalFromDocumentHF19(document);
    if (!firstRows.length) {
      return { ok: false, code: "A6_BCODE_RESULT_ROW_NOT_FOUND", message: String(job.barcode) + " 검색결과에서 상품코드가 있는 정확 행을 찾지 못했습니다.", evidence: { totalResultCount, matchedRows: 0, pageSize: pageSize.pageSize, readOnly: true } };
    }
    if (!Number.isInteger(totalResultCount) && firstRows.length >= pageSize.pageSize) {
      return { ok: false, code: "A6_RESULT_COUNT_UNKNOWN_AT_PAGE_LIMIT", message: String(job.barcode) + " A6 총 조회수를 확인하지 못했고 현재 화면이 최대 " + pageSize.pageSize + "건으로 가득 차 다음 페이지 가능성을 배제할 수 없어 중단했습니다.", evidence: { matchedRows: firstRows.length, pageSize: pageSize.pageSize, readOnly: true, paginationRequired: true } };
    }

    const collected = await collectAllA6RowsHF19(job, firstRows, totalResultCount, pageSize.pageSize);
    if (!collected.ok) return collected;
    const resultRows = collected.rows;
    if (Number.isInteger(totalResultCount) && totalResultCount > 0 && resultRows.length !== totalResultCount) {
      return { ok: false, code: "A6_RESULT_PAGE_INCOMPLETE", message: String(job.barcode) + " A6 조회 " + totalResultCount + "건 중 상품코드 행 " + resultRows.length + "건만 읽혀 일부 누락 위험 때문에 중단했습니다.", evidence: { totalResultCount, matchedRows: resultRows.length, pageSize: pageSize.pageSize, pagesRead: collected.pages, readOnly: true } };
    }

    const pairRegex = /(^|[^0-9])(\\d{4,})-(\\d{4,})(?=[^0-9]|$)/g;
    const discoveredPairs = [];
    for (const entry of resultRows) {
      for (const match of entry.text.matchAll(pairRegex)) {
        discoveredPairs.push({ goodsKey: match[2], optionId: match[3], rowText: entry.text.slice(0, 500) });
      }
    }
    const discoveredGoodsKeys = [...new Set(discoveredPairs.map((pair) => pair.goodsKey).filter((value) => /^\\d+$/.test(value)))].sort((a, b) => Number(a) - Number(b));
    if (!discoveredGoodsKeys.length) {
      return { ok: false, code: "A6_BCODE_GOODSKEY_NOT_FOUND", message: String(job.barcode) + " 검색결과에서 Shopling 상품코드를 읽지 못했습니다.", evidence: { totalResultCount, matchedRows: resultRows.length, pageSize: pageSize.pageSize, pagesRead: collected.pages, readOnly: true } };
    }

    return {
      ok: true,
      completed: true,
      message: String(job.barcode) + " A6 읽기전용 조회 완료 · 최대 화면출력 " + pageSize.pageSize + "개 · " + collected.pages + "페이지 · 상품코드 " + discoveredGoodsKeys.length + "건: " + discoveredGoodsKeys.join(", "),
      evidence: {
        discoveredGoodsKeys,
        discoveredPairs,
        goodsKeyCount: discoveredGoodsKeys.length,
        goodsKeySource: "A6_LIVE_OPTION_BARCODE",
        matchedRows: resultRows.length,
        totalResultCount,
        pageSize: pageSize.pageSize,
        pagesRead: collected.pages,
        paginationMode: collected.pages > 1 ? "SAME_ORIGIN_FETCH_ALL_PAGES" : "SINGLE_PAGE",
        readOnly: true,
        checkboxTouched: false,
        optionStatusTouched: false,
      },
    };
  }

`;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf18Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const canonicalBytes = entries[CANONICAL_LIST];
  const workerBytes = entries[STOCK_WORKER];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !canonicalBytes || !workerBytes || !opsBytes) throw new Error("shopling_stock_hf19_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let canonical = strFromU8(canonicalBytes);
  canonical = replaceOnce(canonical, "  const MAX_VISIBLE_RESULTS = 500;", "  const MAX_VISIBLE_RESULTS = 200;", "shopling_stock_hf19_a21_visible_limit");
  canonical = replaceSegment(
    canonical,
    "  function setPageSize500() {",
    "  function findSearchInput() {",
    `  function setPageSize200HF19() {
    const selects = [...document.querySelectorAll("select")];
    const candidate = selects.find((select) => {
      const labels = [...select.options].map((option) => normalize(option.textContent));
      return labels.includes("200") && (labels.includes("500") || labels.includes("100") || labels.includes("50") || labels.includes("25"));
    });
    if (!candidate) return false;
    const target = [...candidate.options].find((option) => normalize(option.textContent) === "200");
    if (!target) return false;
    if (candidate.value !== target.value) {
      candidate.value = target.value;
      candidate.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return normalize(candidate.options?.[candidate.selectedIndex]?.textContent) === "200";
  }

`,
    "shopling_stock_hf19_a21_page_size_function",
  );
  canonical = replaceOnce(
    canonical,
    "    setPageSize500();",
    '    if (!setPageSize200HF19()) return fail(assignment.jobId, "A21_PAGE_SIZE_200_SET_FAILED", "A21 화면출력을 200개로 고정하지 못했습니다.");',
    "shopling_stock_hf19_a21_page_size_call",
  );
  canonical = replaceOnce(
    canonical,
    `    if (total > MAX_VISIBLE_RESULTS) {
      await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total }).catch(() => null);
      return;
    }`,
    `    if (total > MAX_VISIBLE_RESULTS) {
      if (assignment.goodsKeys.length === 1) return fail(assignment.jobId, "A21_SINGLE_KEY_OVER_200_ROWS", \`GOODSKEY \${assignment.goodsKeys[0]} A21 조회결과가 \${total}건으로 200건을 초과해 부분 송신을 차단했습니다.\`);
      await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total, batchLimit: 200 }).catch(() => null);
      return;
    }`,
    "shopling_stock_hf19_a21_200_batch_guard",
  );
  new Function(canonical);
  entries[CANONICAL_LIST] = strToU8(canonical);

  let worker = strFromU8(workerBytes);
  worker = replaceSegment(worker, "  async function runA6(job) {", "  async function runA4(job, goodsKey) {", A6_REPLACEMENT, "shopling_stock_hf19_a6_replacement");
  new Function(worker);
  entries[STOCK_WORKER] = strToU8(worker);

  let ops = strFromU8(opsBytes);
  const channelSwaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF18", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF19", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF18", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF19", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF18", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF19", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF18", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF19", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF18", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF19", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF18", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF19", "status"],
    ['stockSyncChannel: "HF18"', 'stockSyncChannel: "HF19"', "marker"],
  ];
  for (const [before, after, code] of channelSwaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf19_channel_${code}`);
  new Function(ops);
  entries[CONTENT_OPS] = strToU8(ops);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf19_manifest_version_mismatch");
  if (manifest.background.service_worker !== "background-v059.js") throw new Error("shopling_stock_hf19_hf18_checkpoint_missing");

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF19";
  manifest.description = "HF19: A6 max output + safe multi-page read-only collection, A21 fixed 200-row batches, and SINGLE terminal-result ACK before managed auto-close.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF19`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes('importScripts("background-v059.js")')) throw new Error("shopling_stock_hf19_background_import_missing");
  if (!background.includes("HF19_SINGLE_RESULT_COUNTS_ACK_THEN_AUTOCLOSE")) throw new Error("shopling_stock_hf19_ack_autoclose_marker_missing");
  if (!background.includes("ackBeforeClose: true")) throw new Error("shopling_stock_hf19_ack_before_close_guard_missing");
  if (!worker.includes("setA6MaxPageSizeHF19")) throw new Error("shopling_stock_hf19_a6_max_output_missing");
  if (!worker.includes("SAME_ORIGIN_FETCH_ALL_PAGES")) throw new Error("shopling_stock_hf19_a6_pagination_missing");
  if (!canonical.includes("setPageSize200HF19")) throw new Error("shopling_stock_hf19_a21_200_missing");
  if (canonical.includes("setPageSize500()")) throw new Error("shopling_stock_hf19_a21_old_500_call_present");
  if (!canonical.includes("const MAX_VISIBLE_RESULTS = 200")) throw new Error("shopling_stock_hf19_a21_batch_limit_missing");
  if (ops.includes("_HF18")) throw new Error("shopling_stock_hf19_old_channel_still_present");
  if (!ops.includes('stockSyncChannel: "HF19"')) throw new Error("shopling_stock_hf19_channel_marker_missing");

  for (const required of [BACKGROUND_NEW, CANONICAL_LIST, STOCK_WORKER, CONTENT_OPS]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf19_packaged_file_missing:${required}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const canonicalSha256 = createHash("sha256").update(canonical).digest("hex");
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  const opsSha256 = createHash("sha256").update(ops).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF19_ONLY",
      a6Output: "MAX_AVAILABLE",
      a6Pagination: "SAME_ORIGIN_FETCH_ALL_PAGES_FAIL_CLOSED",
      a6Mutation: false,
      a21Output: 200,
      a21BatchLimit: 200,
      a21AppliesTo: "SOLD_OUT_AND_ON_SALE_AND_OPTION_RESEND_LIST",
      singleCompletion: "ACK_BEFORE_MANAGED_RESULT_CLOSE",
      singleCompletionStabilityMs: 2500,
      singleResultTabTransition: "ADOPT_TERMINAL_SENDER_TAB",
      backgroundSha256,
      canonicalSha256,
      workerSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf19.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF19_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-canonical-sha256": canonicalSha256,
      "x-stock-worker-sha256": workerSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
