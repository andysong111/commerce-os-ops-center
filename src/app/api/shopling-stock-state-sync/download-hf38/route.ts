import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchShoplingStockHf38Background } from "@/lib/shoplingStockHf38Patch";
import { GET as getHf37Download } from "../download-hf37/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.5";
const VERSION = "0.6.6";
const HOTFIX = "HF38_FRESH_OWNED_A6_POPUP_HANDOFF";
const COORDINATOR = "background-v030.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf37Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const coordinatorBytes = entries[COORDINATOR];
  if (!manifestBytes || !coordinatorBytes) {
    throw new Error("shopling_stock_hf38_required_entry_missing");
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
    throw new Error("shopling_stock_hf38_manifest_version_mismatch");
  }

  const coordinator = patchShoplingStockHf38Background(
    strFromU8(coordinatorBytes),
  );
  new Function(coordinator);
  for (const guard of [
    "HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER",
    "baselineTabIds.has(candidate.id)",
    "current.openerTabId === launcherTabId",
    "HF38_FRESH_POPUP_AMBIGUOUS",
    "if (!menuClickedHf38)",
  ]) {
    if (!coordinator.includes(guard)) {
      throw new Error(`shopling_stock_hf38_popup_guard_missing:${guard}`);
    }
  }
  entries[COORDINATOR] = strToU8(coordinator);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF38";
  manifest.description =
    "HF38 claims only the single exact-role Shopling popup opened by the current worker tab after the menu click. Stale or ambiguous A6 popups fail closed before product mutation.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF38`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    COORDINATOR,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf38_missing_packaged_file:${file}`);
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
        freshPopupRequired: true,
        exactPopupRoleRequired: true,
        openerOwnershipRequired: true,
        stalePopupAdoptionBlocked: true,
        ambiguousPopupAdoptionBlocked: true,
        menuClickAtMostOnce: true,
        incidentRegression:
          "A6_POPUP_OPENED_IN_SEPARATE_TAB_WHILE_LAUNCHER_REMAINED_A21_LIST",
        hf37DateAndHf36FrameGuardsPreserved: true,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.6-hf38.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-fresh-owned-popup": "true",
      "x-stock-coordinator-sha256": coordinatorSha256,
    },
  });
}
