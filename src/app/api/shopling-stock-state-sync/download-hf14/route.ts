import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf13Download } from "../download-hf13/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF14_SINGLE_A21_IGNORE_DELETED_REQUESTED_KEYS_ONLY";
const BACKGROUND_FILE = "background-v058.js";
const CANONICAL_LIST_FILE = "content-a21-canonical-v014.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const hf13Response = await getHf13Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!hf13Response.ok) return hf13Response;

  const entries = unzipSync(new Uint8Array(await hf13Response.arrayBuffer()));
  const canonicalBytes = entries[CANONICAL_LIST_FILE];
  const manifestBytes = entries["manifest.json"];
  if (!canonicalBytes || !manifestBytes) throw new Error("shopling_stock_hf14_required_entry_missing");

  const canonicalBefore = strFromU8(canonicalBytes);
  const strictMissingBlock = `    const { matched, seen, target } = findResultRows(assignment.goodsKeys);\n    const missing = [...target].filter((key) => !seen.has(key));\n    if (missing.length) return fail(assignment.jobId, "A21_GOODSKEY_RESULT_MISSING", \`검색 결과에 GOODSKEY \${missing.slice(0, 8).join(", ")}\${missing.length > 8 ? " 외" : ""}가 없습니다.\`);\n    if (matched.length !== total) return fail(assignment.jobId, "A21_VISIBLE_ROW_COUNT_MISMATCH", \`조회수 \${total}건 중 안전하게 식별한 행은 \${matched.length}건이라 전송하지 않았습니다.\`);`;
  const tolerantMissingBlock = `    const { matched, seen, target } = findResultRows(assignment.goodsKeys);\n    const missing = [...target].filter((key) => !seen.has(key));\n    const singleStockBatch = /^SINGLE_(?:BATCH|SPLIT)/.test(String(assignment.stage || ""));\n    if (missing.length && !singleStockBatch) return fail(assignment.jobId, "A21_GOODSKEY_RESULT_MISSING", \`검색 결과에 GOODSKEY \${missing.slice(0, 8).join(", ")}\${missing.length > 8 ? " 외" : ""}가 없습니다.\`);\n    if (matched.length !== total) return fail(assignment.jobId, "A21_VISIBLE_ROW_COUNT_MISMATCH", \`조회수 \${total}건 중 A6 유래 GOODSKEY로 안전하게 식별한 행은 \${matched.length}건이라 다른 상품 혼입 위험 때문에 전송하지 않았습니다.\`);`;

  let canonical = replaceOnce(
    canonicalBefore,
    strictMissingBlock,
    tolerantMissingBlock,
    "shopling_stock_hf14_missing_goodskey_policy",
  );

  const oldStage = `    await stage(assignment.jobId, "POPUP_OPENING", { selectedRowCount: checked, totalResultCount: total, message: \`${'${checked}'}개 쇼핑몰 행 선택 완료\` });`;
  const newStage = `    await stage(assignment.jobId, "POPUP_OPENING", {\n      selectedRowCount: checked,\n      totalResultCount: total,\n      requestedGoodsKeyCount: assignment.goodsKeys.length,\n      matchedGoodsKeyCount: seen.size,\n      missingGoodsKeys: singleStockBatch ? missing : [],\n      missingGoodsKeysIgnored: Boolean(singleStockBatch && missing.length),\n      returnedRowsRestrictedToRequestedGoodsKeys: matched.length === total,\n      message: singleStockBatch && missing.length\n        ? \`${'${checked}'}개 쇼핑몰 행 선택 완료 · 삭제/미존재 GOODSKEY ${'${missing.length}'}건 무시\`\n        : \`${'${checked}'}개 쇼핑몰 행 선택 완료\`,\n    });`;
  canonical = replaceOnce(canonical, oldStage, newStage, "shopling_stock_hf14_stage_evidence");
  new Function(canonical);
  entries[CANONICAL_LIST_FILE] = strToU8(canonical);

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  new Function(background);
  entries[BACKGROUND_FILE] = strToU8(background);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf14_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v057.js") {
    throw new Error("shopling_stock_hf14_hf13_checkpoint_missing");
  }
  for (const checkpoint of [
    "background-v055.js",
    "background-v056.js",
    "background-v057.js",
    "content-stock-single-popup-v011.js",
    CANONICAL_LIST_FILE,
  ]) {
    if (!entries[checkpoint]) throw new Error(`shopling_stock_hf14_checkpoint_missing:${checkpoint}`);
  }

  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF14`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!canonical.includes('const singleStockBatch = /^SINGLE_(?:BATCH|SPLIT)/')) {
    throw new Error("shopling_stock_hf14_single_only_tolerance_guard_missing");
  }
  if (!canonical.includes("missing.length && !singleStockBatch")) {
    throw new Error("shopling_stock_hf14_option_strict_missing_guard_missing");
  }
  if (!canonical.includes("matched.length !== total")) {
    throw new Error("shopling_stock_hf14_returned_row_containment_guard_missing");
  }
  if (!canonical.includes("missingGoodsKeysIgnored")) {
    throw new Error("shopling_stock_hf14_missing_evidence_guard_missing");
  }
  if (!background.includes('importScripts("background-v057.js")')) {
    throw new Error("shopling_stock_hf14_hf13_background_import_missing");
  }
  if (!background.includes("returnedRowsRestrictedToA6DerivedGoodsKeys: true")) {
    throw new Error("shopling_stock_hf14_evidence_safety_guard_missing");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf14_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const canonicalSha256 = createHash("sha256").update(canonical).digest("hex");
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      optionFlow: "HF10_STRICT_MISSING_GOODSKEY_POLICY_UNCHANGED",
      singleFlow: "A6_READ_ONLY_BCODE_RESOLVE_THEN_A21_EXISTING_ROWS_ONLY",
      singleA4Used: false,
      singleMissingRequestedGoodsKeys: "IGNORE_AS_DELETED_OR_STALE",
      singleNoA21Rows: "FAIL_SAFE",
      singleReturnedRowSafety: "EVERY_RETURNED_ROW_MUST_MATCH_A6_DERIVED_GOODSKEY",
      singleTransmitScope: "ONLY_ROWS_RETURNED_FROM_A21_FOR_A6_DERIVED_GOODSKEYS",
      singleGoodsKeyBatchMax: 200,
      singleA21VisibleRowLimit: 500,
      singlePopupMode: "상품판매상태송신_ONLY",
      backgroundAdapter: BACKGROUND_FILE,
      backgroundSha256,
      canonicalList: CANONICAL_LIST_FILE,
      canonicalSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf14.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-canonical-sha256": canonicalSha256,
    },
  });
}
