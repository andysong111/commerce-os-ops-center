import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf9Download } from "../download-hf9/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF10_PRICE_V044_CDP_AX_DEFINITIVE_COMPLETION_MANAGED_AUTOCLOSE";
const BACKGROUND_FILE = "background-v055.js";
const STABLE_MS = 2500;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const hf9Response = await getHf9Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!hf9Response.ok) return hf9Response;

  const entries = unzipSync(new Uint8Array(await hf9Response.arrayBuffer()));
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  new Function(background);
  entries[BACKGROUND_FILE] = strToU8(background);

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf10_manifest_missing");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    permissions: string[];
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf10_manifest_version_mismatch");
  if (!entries["background-v054.js"] || !entries["background-v053.js"] || !entries["content-a21-canonical-v014.js"]) {
    throw new Error("shopling_stock_hf10_prior_working_core_missing");
  }
  for (const permission of ["tabs", "windows", "scripting", "debugger"]) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission);
  }

  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF10`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes('importScripts("background-v054.js")')) throw new Error("shopling_stock_hf10_must_preserve_hf9_hf8_core");
  if (!background.includes("Accessibility.getFullAXTree")) throw new Error("shopling_stock_hf10_accessibility_probe_missing");
  if (!background.includes('chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate"')) throw new Error("shopling_stock_hf10_runtime_probe_missing");
  if (!background.includes("STABLE_MS_V055 = 2_500")) throw new Error("shopling_stock_hf10_stability_window_missing");
  if (!background.includes("chrome.windows.remove(tab.windowId)")) throw new Error("shopling_stock_hf10_managed_window_close_missing");
  if (!background.includes("chrome.tabs.remove(tabId)")) throw new Error("shopling_stock_hf10_tab_close_fallback_missing");
  if (!background.includes("continueNextGoodsKey(latest, sender, evidence)")) throw new Error("shopling_stock_hf10_success_advance_missing");
  if (!background.includes("PRICE_V044_CDP_AX_AUTOCLOSE_HF10")) throw new Error("shopling_stock_hf10_completion_watcher_marker_missing");

  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf10_missing_packaged_file:${file}`);
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
      hf9FallbackObserverPreserved: true,
      a21ListExecution: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      popupExecution: "EXISTING_LITERAL_PRICECORE_V024_OPTION_ONLY",
      completionDetection: "PRICE_V044_STYLE_CDP_ALL_CONTEXTS_PLUS_ACCESSIBILITY",
      completionFooter: "상품옵션 수정 전송이 완료되었습니다.",
      completionStabilityMs: STABLE_MS,
      completionProcessingGuard: true,
      managedResultClose: "single managed popup window => chrome.windows.remove; shared window => chrome.tabs.remove",
      resultTarget: "tracked A21_POPUP tab from PriceCore claim",
      marketplaceFailurePolicy: "SHOPLING_COMPLETION_AUTHORITATIVE_MARKETPLACE_FAILURES_ADVISORY",
      debuggerPermission: manifest.permissions.includes("debugger"),
      backgroundAdapter: BACKGROUND_FILE,
      backgroundSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf10.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
