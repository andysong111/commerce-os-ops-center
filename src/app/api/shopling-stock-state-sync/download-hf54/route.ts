import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf53Download } from "../download-hf53/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.18";
const VERSION = "0.6.19";
const HOTFIX = "HF54_BOUNDED_PARALLEL_SESSION_PREFLIGHT";
const BACKGROUND_OLD = "background-v077.js";
const BACKGROUND_NEW = "background-v078.js";
const CONTENT_PREFLIGHT = "content-ops-preflight-v002.js";
const CONTENT_OPS = "content-ops-v021.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf53Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BACKGROUND_OLD]) {
    throw new Error("shopling_stock_hf54_required_entry_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ matches?: string[]; js: string[] }>;
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BACKGROUND_OLD
  ) {
    throw new Error("shopling_stock_hf54_manifest_checkpoint_mismatch");
  }

  const commerceOpsScript = manifest.content_scripts.find((script) =>
    script.js.includes(CONTENT_OPS),
  );
  if (!commerceOpsScript) {
    throw new Error("shopling_stock_hf54_commerce_ops_script_missing");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, preflightBridge] = await Promise.all([
    readFile(path.join(root, BACKGROUND_NEW), "utf8"),
    readFile(path.join(root, CONTENT_PREFLIGHT), "utf8"),
  ]);
  new Function(background);
  new Function(preflightBridge);
  for (const guard of [
    'importScripts("background-v077.js")',
    'const REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT_HF54"',
    "Promise.all(candidates.map(inspectTab))",
    "const MAX_RECENT_TABS = 32",
    "const PER_TAB_TIMEOUT_MS = 2_500",
    "parallelInspection: true",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf54_background_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    'const RUNTIME_REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT_HF54"',
    'stockSyncChannel: "HF54"',
  ]) {
    if (!preflightBridge.includes(guard)) {
      throw new Error(`shopling_stock_hf54_bridge_guard_missing:${guard}`);
    }
  }

  entries[BACKGROUND_NEW] = strToU8(background);
  entries[CONTENT_PREFLIGHT] = strToU8(preflightBridge);
  commerceOpsScript.js = [
    CONTENT_PREFLIGHT,
    ...commerceOpsScript.js.filter((file) => file !== CONTENT_PREFLIGHT),
  ];
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF54";
  manifest.description =
    "HF54 inspects recent Shopling tabs concurrently with a per-tab bound, so login preflight finishes before any STARTED record or Shopling stock-state write even when many admin tabs remain open.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF54`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf54_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    background: createHash("sha256").update(background).digest("hex"),
    contentPreflight: createHash("sha256")
      .update(preflightBridge)
      .digest("hex"),
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        concurrentRecentTabPreflight: true,
        maxRecentTabs: 32,
        perTabTimeoutMs: 2_500,
        loginPreflightBeforeStarted: true,
        noShoplingWrite: true,
        incidentRegression:
          "BCC2_1_PREFLIGHT_TIMED_OUT_WITH_MANY_OPEN_SHOPLING_TABS_BEFORE_STARTED",
        hashes,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.19-hf54.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-session-preflight": "parallel-bounded-read-only",
      "x-stock-background-sha256": hashes.background,
      "x-stock-content-preflight-sha256": hashes.contentPreflight,
    },
  });
}
