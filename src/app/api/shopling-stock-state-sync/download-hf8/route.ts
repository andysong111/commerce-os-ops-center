import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getBaseDownload } from "../download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF8_LITERAL_PRICE_EXTENSION_A21_LIST_AND_PRICECORE_POPUP";
const CANONICAL_LIST_FILE = "content-a21-canonical-v014.js";
const BACKGROUND_FILE = "background-v053.js";
const POPUP_PATH = "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getBaseDownload(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const canonicalRoot = path.join(process.cwd(), "public", "shopling-a21-price-option-resend");

  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  const canonicalList = await readFile(path.join(canonicalRoot, "content-a21.js"), "utf8");
  new Function(background);
  new Function(canonicalList);

  entries[BACKGROUND_FILE] = strToU8(background);
  // Byte-for-byte copy of the proven price-adjustment A21 list engine.
  entries[CANONICAL_LIST_FILE] = strToU8(canonicalList);

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf8_base_manifest_missing");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{
      matches: string[];
      exclude_matches?: string[];
      js: string[];
      all_frames?: boolean;
      run_at?: string;
      world?: string;
    }>;
  };

  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf8_manifest_version_mismatch");
  }
  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF8`;

  const canonicalScript = {
    matches: ["https://a.shopling.co.kr/*"],
    exclude_matches: [POPUP_PATH],
    js: [CANONICAL_LIST_FILE],
    all_frames: true,
    run_at: "document_idle",
  };
  manifest.content_scripts = manifest.content_scripts.filter(
    (script) => !script.js?.includes(CANONICAL_LIST_FILE),
  );
  const stockListIndex = manifest.content_scripts.findIndex((script) =>
    script.js?.includes("content-shopling-v030.js"),
  );
  if (stockListIndex >= 0) manifest.content_scripts.splice(stockListIndex + 1, 0, canonicalScript);
  else manifest.content_scripts.push(canonicalScript);
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf8_missing_packaged_file:${file}`);
  }

  const canonicalPackaged = strFromU8(entries[CANONICAL_LIST_FILE]);
  if (canonicalPackaged !== canonicalList) {
    throw new Error("shopling_stock_hf8_canonical_list_not_literal_copy");
  }
  if (!canonicalList.includes("for (const item of matched) setControl(item.checkbox, true);")) {
    throw new Error("shopling_stock_hf8_price_row_selection_source_missing");
  }
  if (!canonicalList.includes("if (!clickModifySend())")) {
    throw new Error("shopling_stock_hf8_price_modify_send_source_missing");
  }
  if (!background.includes("PRICE_EXTENSION_CONTENT_A21_LITERAL")) {
    throw new Error("shopling_stock_hf8_background_adapter_guard_missing");
  }

  const zip = zipSync(entries, { level: 9 });
  const canonicalListSha256 = createHash("sha256").update(canonicalList).digest("hex");
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      files: Object.keys(entries),
      zipBytes: zip.byteLength,
      canonicalListLiteralCopyVerified: canonicalPackaged === canonicalList,
      canonicalListSource: "shopling-a21-price-option-resend/content-a21.js",
      canonicalListPackagedAs: CANONICAL_LIST_FILE,
      canonicalListSha256,
      backgroundAdapter: BACKGROUND_FILE,
      backgroundSha256,
      a21ListExecution: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      a21Selection: "CANONICAL_SETCONTROL_EACH_MATCHED_ROW",
      a21SelectionSequence: "checkbox.click() -> checked=true -> input -> change",
      a21ModifySendClick: "CANONICAL_clickModifySend",
      popupStageTransition: "ONLY_REAL_EXACT_POPUP_PRICECORE_CLAIM",
      popupExecution: "EXISTING_LITERAL_PRICECORE_V024_OPTION_ONLY",
      staleFalsePopupRecovery: true,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf8.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-canonical-list-sha256": canonicalListSha256,
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
