import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf10Download } from "../download-hf10/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF11_SINGLE_A4_CANONICAL_A21_SALE_STATUS_AUTOCLOSE";
const BACKGROUND_FILE = "background-v056.js";
const SINGLE_POPUP_FILE = "content-stock-single-popup-v011.js";
const POPUP_MATCH = "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const hf10Response = await getHf10Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!hf10Response.ok) return hf10Response;

  const entries = unzipSync(new Uint8Array(await hf10Response.arrayBuffer()));
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  const singlePopup = await readFile(path.join(root, SINGLE_POPUP_FILE), "utf8");
  new Function(background);
  new Function(singlePopup);
  entries[BACKGROUND_FILE] = strToU8(background);
  entries[SINGLE_POPUP_FILE] = strToU8(singlePopup);

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf11_manifest_missing");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    permissions: string[];
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
    throw new Error("shopling_stock_hf11_manifest_version_mismatch");
  }
  if (!entries["background-v055.js"] || !entries["content-a21-canonical-v014.js"]) {
    throw new Error("shopling_stock_hf11_hf10_checkpoint_missing");
  }

  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF11`;
  manifest.content_scripts = manifest.content_scripts.filter(
    (script) => !script.js?.includes(SINGLE_POPUP_FILE),
  );
  manifest.content_scripts.push({
    matches: [POPUP_MATCH],
    js: [SINGLE_POPUP_FILE],
    all_frames: true,
    run_at: "document_idle",
  });
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes('importScripts("background-v055.js")')) {
    throw new Error("shopling_stock_hf11_must_preserve_hf10_option_checkpoint");
  }
  if (!background.includes("PRICE_EXTENSION_CONTENT_A21_LITERAL_SINGLE_LIST_ONLY")) {
    throw new Error("shopling_stock_hf11_single_canonical_a21_missing");
  }
  if (!background.includes('active.job?.productKind === "SINGLE"')) {
    throw new Error("shopling_stock_hf11_single_guard_missing");
  }
  if (!singlePopup.includes("상품판매상태송신")) {
    throw new Error("shopling_stock_hf11_sale_status_mode_missing");
  }
  if (!singlePopup.includes('desiredStatus === "SOLD_OUT" ? "품절" : desiredStatus === "ON_SALE" ? "판매중"')) {
    throw new Error("shopling_stock_hf11_sale_status_target_mapping_missing");
  }
  if (!singlePopup.includes("clickViaMain(button)")) {
    throw new Error("shopling_stock_hf11_main_world_submit_missing");
  }
  if (!background.includes("closeManagedSinglePopup")) {
    throw new Error("shopling_stock_hf11_single_result_autoclose_missing");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf11_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const singlePopupSha256 = createHash("sha256").update(singlePopup).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      files: Object.keys(entries),
      zipBytes: zip.byteLength,
      hf10OptionCheckpointPreserved: true,
      optionA21Execution: "HF10_PRICE_EXTENSION_LITERAL_UNCHANGED",
      singleFlow: "A4_PRODUCT_STATE_THEN_CANONICAL_A21_LIST_THEN_DEDICATED_SALE_STATUS_POPUP",
      singleA21ListExecution: "PRICE_EXTENSION_CONTENT_A21_LITERAL_LIST_ONLY",
      singleA21Selection: "ALL_EXACT_GOODSKEY_ROWS",
      singlePopupMode: "상품판매상태송신_ONLY",
      singleStatusMapping: { SOLD_OUT: "품절", ON_SALE: "판매중" },
      singleCompletionDetection: "PRODUCT_COMPLETE_FOOTER_ALL_FRAMES_STABLE",
      singleCompletionStabilityMs: 2500,
      singleResultAutoClose: true,
      backgroundAdapter: BACKGROUND_FILE,
      backgroundSha256,
      singlePopupWorker: SINGLE_POPUP_FILE,
      singlePopupSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf11.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-single-popup-sha256": singlePopupSha256,
    },
  });
}
