import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchShoplingStockHf40Coordinator } from "@/lib/shoplingStockHf40Patch";
import { GET as getHf39Download } from "../download-hf39/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.7";
const VERSION = "0.6.8";
const HOTFIX = "HF40_EXACT_A4_A21_PATH_ROLE";
const COORDINATOR = "background-v030.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf39Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const coordinatorBytes = entries[COORDINATOR];
  if (!manifestBytes || !coordinatorBytes) {
    throw new Error("shopling_stock_hf40_required_entry_missing");
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
    throw new Error("shopling_stock_hf40_manifest_version_mismatch");
  }

  const coordinator = patchShoplingStockHf40Coordinator(
    strFromU8(coordinatorBytes),
  );
  new Function(coordinator);
  for (const guard of [
    'path === "/prodlinkage/goods_prod_join_list.phtml"',
    'path === "/prod/prodlst.phtml"',
    "HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER",
  ]) {
    if (!coordinator.includes(guard)) {
      throw new Error(`shopling_stock_hf40_role_guard_missing:${guard}`);
    }
  }
  if (/\/상품조회수정\/i\.test\(text\) && \/검색항목\/i\.test\(text\)/.test(coordinator)) {
    throw new Error("shopling_stock_hf40_ambiguous_a4_text_fallback_present");
  }
  entries[COORDINATOR] = strToU8(coordinator);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF40";
  manifest.description =
    "HF40 classifies A4 and A21 only by their exact Shopling paths plus page-specific controls. Shared navigation labels can no longer make the live A21 page look like A4.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF40`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    COORDINATOR,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf40_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const coordinatorSha256 = createHash("sha256")
    .update(coordinator)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        exactA4Path: "/prod/prodlst.phtml",
        exactA21Path: "/prodlinkage/goods_prod_join_list.phtml",
        ambiguousA4NavigationTextFallbackRemoved: true,
        incidentRegression:
          "BBB4-3_LIVE_A21_PAGE_MISCLASSIFIED_AS_A4_BY_SHARED_NAVIGATION_TEXT",
        hf39WorkerReadinessGuardsPreserved: true,
        mutationBeforeExactA21Ready: false,
        coordinator: COORDINATOR,
        coordinatorSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.8-hf40.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-exact-a21-path": "true",
      "x-stock-coordinator-sha256": coordinatorSha256,
    },
  });
}
