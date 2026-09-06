import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { buildStockWorkerV030 } from "../../../../../scripts/build-shopling-stock-worker-v030.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const VERSION = "0.4.3";
const FILES = [
  "manifest.json",
  "background-v020.js",
  "background-v030.js",
  "background-v040.js",
  "content-ops-v021.js",
  "content-a21-popup-v043.js",
  "main-shopling.js",
  "popup.html",
  "popup.js",
  "README.txt",
];

export async function GET(request: Request) {
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const entries: Record<string, Uint8Array> = {};
  for (const name of FILES) {
    const source = await readFile(path.join(root, name), "utf8");
    if (name.endsWith(".js")) new Function(source);
    entries[name] = strToU8(source);
  }
  const template = await readFile(
    path.join(root, "content-shopling-v018.js"),
    "utf8",
  );
  const policy = await readFile(
    path.join(root, "search-policy-v023.js"),
    "utf8",
  );
  const builtWorker = buildStockWorkerV030(template, policy);
  if (!builtWorker.includes('const VERSION = "0.4.2";')) {
    throw new Error("shopling_stock_state_list_worker_version_template_mismatch");
  }
  const worker = builtWorker
    .replace('const VERSION = "0.4.2";', 'const VERSION = "0.4.3";')
    .replaceAll("__commerceStockWorkerV042", "__commerceStockWorkerV043");
  new Function(worker);
  entries["content-shopling-v030.js"] = strToU8(worker);
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  ) as {
    manifest_version: number;
    version: string;
    permissions: string[];
    host_permissions: string[];
    background: { service_worker: string };
    action: { default_popup: string };
    content_scripts: Array<{
      js: string[];
      matches: string[];
      exclude_matches?: string[];
      world?: string;
      all_frames?: boolean;
    }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_state_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v040.js") {
    throw new Error("shopling_stock_state_background_required");
  }
  for (const permission of [
    "storage",
    "tabs",
    "windows",
    "scripting",
    "webNavigation",
    "alarms",
  ]) {
    if (!manifest.permissions.includes(permission)) {
      throw new Error(`shopling_stock_state_permission_missing:${permission}`);
    }
  }
  for (const host of [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]) {
    if (!manifest.host_permissions.includes(host)) {
      throw new Error("shopling_stock_state_host_permissions_missing");
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_state_missing_packaged_file:${file}`);
    }
  }
  const listWorker = manifest.content_scripts.find((script) =>
    script.js.includes("content-shopling-v030.js"),
  );
  const popupWorker = manifest.content_scripts.find((script) =>
    script.js.includes("content-a21-popup-v043.js"),
  );
  if (!listWorker?.exclude_matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml"))) {
    throw new Error("shopling_stock_state_popup_must_be_excluded_from_list_worker");
  }
  if (!popupWorker?.matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml"))) {
    throw new Error("shopling_stock_state_dedicated_popup_worker_required");
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  const popupWorkerSha256 = createHash("sha256")
    .update(await readFile(path.join(root, "content-a21-popup-v043.js"), "utf8"))
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        files: Object.keys(entries),
        zipBytes: zip.byteLength,
        workerSha256,
        popupWorkerSha256,
        searchStart: "2024-01-01",
        mode: "SHOPLING_API_OPTION_STATUS_THEN_A21_MULTIROW_POPUP_V043",
        optionLocalMutation: "SERVER_API_GUARDED",
        a21SearchBinding: "ROW_SCOPED_VERIFIED",
        a21SearchSubmitGuard: "ONE_CLICK_TICKET",
        a21ResultSelection: "EXACT_GOODS_KEY_ALL_ROWS_UP_TO_200",
        a21BatchLimit: 200,
        a21PopupConfiguration: "PRICE_ENGINE_PROVEN_OPTION_MODE_PLUS_SELECTION",
        popupWorkerIsolation: "DEDICATED_GOODS_MALL_MDFY_TRSMT_WORKER",
        optionBrowserStages: ["A21_LIST", "A21_POPUP"],
        singleBrowserStages: ["A4", "A21_LIST", "A21_POPUP"],
        liveShoplingVerified: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-worker-sha256": workerSha256,
      "x-stock-popup-worker-sha256": popupWorkerSha256,
    },
  });
}
