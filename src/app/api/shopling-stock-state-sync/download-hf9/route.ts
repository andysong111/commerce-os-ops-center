import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf8Download } from "../download-hf8/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF9_PRICE_STYLE_COMPLETION_STABILITY_RESULT_AUTOCLOSE";
const BACKGROUND_FILE = "background-v054.js";
const STABLE_MS = 1800;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const hf8Response = await getHf8Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!hf8Response.ok) return hf8Response;

  const entries = unzipSync(new Uint8Array(await hf8Response.arrayBuffer()));
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  new Function(background);
  entries[BACKGROUND_FILE] = strToU8(background);

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf9_manifest_missing");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    permissions: string[];
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf9_manifest_version_mismatch");
  }
  if (!entries["background-v053.js"] || !entries["content-a21-canonical-v014.js"]) {
    throw new Error("shopling_stock_hf9_hf8_canonical_core_missing");
  }
  for (const permission of ["tabs", "scripting"]) {
    if (!manifest.permissions.includes(permission)) throw new Error(`shopling_stock_hf9_permission_missing:${permission}`);
  }

  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF9`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes('importScripts("background-v053.js")')) {
    throw new Error("shopling_stock_hf9_must_preserve_hf8_core");
  }
  if (!background.includes("STABLE_MS_V054 = 1_800")) {
    throw new Error("shopling_stock_hf9_stability_window_missing");
  }
  if (!background.includes("target: { tabId, allFrames: true }")) {
    throw new Error("shopling_stock_hf9_all_frame_completion_probe_missing");
  }
  if (!background.includes("chrome.tabs.remove(resultTabId)")) {
    throw new Error("shopling_stock_hf9_result_autoclose_missing");
  }
  if (!background.includes("상품\\s*옵션\\s*(?:수정\\s*)?전송이\\s*완료되었습니다")) {
    throw new Error("shopling_stock_hf9_exact_option_footer_missing");
  }
  if (!background.includes("legacyHandleEvidenceV054(normalizedMessage, sender)")) {
    throw new Error("shopling_stock_hf9_existing_success_policy_not_preserved");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf9_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      files: Object.keys(entries),
      zipBytes: zip.byteLength,
      hf8A21CorePreserved: true,
      a21ListExecution: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      popupExecution: "EXISTING_LITERAL_PRICECORE_V024_OPTION_ONLY",
      completionDetection: "SHOPLING_OPTION_COMPLETE_FOOTER_ALL_FRAMES",
      completionStabilityMs: STABLE_MS,
      completionProcessingGuard: true,
      resultAutoClose: "chrome.tabs.remove(resultTabId)",
      resultAutoCloseAfterSuccessFinalization: true,
      marketplaceFailurePolicy: "SHOPLING_COMPLETION_AUTHORITATIVE_MARKETPLACE_FAILURES_ADVISORY",
      backgroundAdapter: BACKGROUND_FILE,
      backgroundSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf9.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
