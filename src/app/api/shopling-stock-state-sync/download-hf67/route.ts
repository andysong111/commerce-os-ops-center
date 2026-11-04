import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf66Download } from "../download-hf66/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.29";
const VERSION = "0.6.30";
const HOTFIX = "HF67_KT_ADMIN_AND_OWNED_A21_PREFLIGHT";
const BASE_BACKGROUND = "background-v087.js";
const BACKGROUND = "background-v088.js";
const BASE_PREFLIGHT = "content-ops-preflight-v002.js";
const PREFLIGHT = "content-ops-preflight-v003.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf66Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (
    !manifestBytes ||
    !entries[BASE_BACKGROUND] ||
    !entries[BASE_PREFLIGHT]
  ) {
    throw new Error("shopling_stock_hf67_base_package_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
    host_permissions?: string[];
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf67_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, preflight] = await Promise.all([
    readFile(path.join(root, BACKGROUND), "utf8").then(normalized),
    readFile(path.join(root, PREFLIGHT), "utf8").then(normalized),
  ]);
  new Function(background);
  new Function(preflight);
  entries[BACKGROUND] = strToU8(background);
  entries[PREFLIGHT] = strToU8(preflight);

  const preflightEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_PREFLIGHT),
  );
  if (!preflightEntry) {
    throw new Error("shopling_stock_hf67_preflight_entry_missing");
  }
  preflightEntry.js = preflightEntry.js.map((file) =>
    file === BASE_PREFLIGHT ? PREFLIGHT : file,
  );

  const requiredHostPermissions = [
    "https://a.shopling.co.kr/*",
    "https://kt.shopling.co.kr/*",
  ];
  for (const permission of requiredHostPermissions) {
    if (!manifest.host_permissions?.includes(permission) &&
        !manifest.host_permissions?.includes("https://*.shopling.co.kr/*")) {
      throw new Error(`shopling_stock_hf67_host_permission_missing:${permission}`);
    }
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF67";
  manifest.description =
    "HF67 recognizes the authenticated kt.shopling.co.kr admin shell and prepares exactly one owned A21 worker before any stock-state API mutation or STARTED record.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF67`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    '"https://kt.shopling.co.kr/*"',
    '"https://a.shopling.co.kr/*"',
    'const REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT_HF67"',
    'const WORKSPACE_KEY = "commerceStockWorkspaceV030"',
    'ownershipPolicy: "HF67_KT_ADMIN_EXACT_A21_WORKER"',
    'browserStagesSkipped: ["A4", "A6"]',
    "noProductMutation: true",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf67_guard_missing:${guard}`);
    }
  }
  if (!preflight.includes("STOCK_SYNC_SESSION_PREFLIGHT_HF67")) {
    throw new Error("shopling_stock_hf67_bridge_guard_missing");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf67_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256")
    .update(background)
    .digest("hex");
  const preflightSha256 = createHash("sha256")
    .update(preflight)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rootCause:
          "HF54_PREFLIGHT_AND_HF65_A21_START_ONLY_RECOGNIZED_A_SHOPLING_TOP_LEVEL_TABS",
        acceptedAdminHosts: ["kt.shopling.co.kr", "a.shopling.co.kr"],
        preMutationA21Preparation: true,
        a21Ownership: "DEDICATED_EXACT_ROLE_AND_OPENER_WORKER",
        shoplingMutation: "API_ONLY_AFTER_A21_READY",
        readback: "API_STATUS_AND_QUANTITY",
        browserStages: ["A21_LIST", "A21_PROCESSING_OR_RESULT"],
        skippedBrowserStages: ["A4", "A6"],
        marketplaceCompletionRequired: false,
        sourceAdminTabPreserved: true,
        backgroundSha256,
        preflightSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.30-hf67.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-admin-hosts": "kt.shopling.co.kr,a.shopling.co.kr",
      "x-stock-pre-mutation-a21-ready": "true",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-preflight-sha256": preflightSha256,
    },
  });
}
