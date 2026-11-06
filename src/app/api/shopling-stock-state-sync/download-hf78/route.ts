import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf78AdminDomainCoverage,
  patchHf78SinglePopupSource,
  type ShoplingManifestForHf78,
} from "@/lib/shoplingStockHf78Patch";
import { GET as getHf77Download } from "../download-hf77/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.40";
const VERSION = "0.6.41";
const HOTFIX = "HF78_KT_ADMIN_CONTENT_SCRIPT_AND_MAIN_WORLD_COVERAGE";
const MAIN = "main-shopling-v002.js";
const SINGLE_POPUP = "content-stock-single-popup-v012.js";

type Manifest = ShoplingManifestForHf78 & {
  manifest_version: number;
  version: string;
  name?: string;
  description?: string;
  background: { service_worker: string };
  action: { default_title?: string; default_popup: string };
};

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf77Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const popupBytes = entries[SINGLE_POPUP];
  if (!manifestBytes || !entries[MAIN] || !popupBytes) {
    throw new Error("shopling_stock_hf78_base_file_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest;
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf78_manifest_checkpoint_mismatch");
  }

  patchHf78AdminDomainCoverage(manifest);
  const singlePopup = patchHf78SinglePopupSource(
    normalized(strFromU8(popupBytes)),
  );
  new Function(singlePopup);
  entries[SINGLE_POPUP] = strToU8(singlePopup);

  const mainWorldEntry = manifest.content_scripts.find(
    (script) => script.world === "MAIN" && script.js.includes(MAIN),
  );
  if (
    !mainWorldEntry ||
    mainWorldEntry.all_frames !== true ||
    mainWorldEntry.run_at !== "document_start" ||
    !mainWorldEntry.matches.includes("https://a.shopling.co.kr/*") ||
    !mainWorldEntry.matches.includes("https://kt.shopling.co.kr/*")
  ) {
    throw new Error("shopling_stock_hf78_main_world_domain_coverage_missing");
  }

  const popupEntry = manifest.content_scripts.find((script) =>
    script.js.includes(SINGLE_POPUP),
  );
  const popupPath = "/prodlinkage/goods_mallMdfy_trsmt.phtml*";
  if (
    !popupEntry ||
    !popupEntry.matches.includes(`https://a.shopling.co.kr${popupPath}`) ||
    !popupEntry.matches.includes(`https://kt.shopling.co.kr${popupPath}`)
  ) {
    throw new Error("shopling_stock_hf78_popup_domain_coverage_missing");
  }

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF78";
  manifest.description =
    "HF78 injects the proven A21 MAIN-world click bridge and result workers on both current kt.shopling.co.kr and legacy a.shopling.co.kr admin hosts.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF78`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf78_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const manifestSha256 = createHash("sha256")
    .update(strFromU8(entries["manifest.json"]))
    .digest("hex");
  const popupSha256 = createHash("sha256").update(singlePopup).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rootCause:
          "LIVE_A21_WORKER_MOVED_TO_KT_SHOPLING_BUT_CONTENT_SCRIPTS_ONLY_MATCHED_A_SHOPLING",
        acceptedAdminHosts: ["kt.shopling.co.kr", "a.shopling.co.kr"],
        mainWorldInjection: "BOTH_ADMIN_HOSTS_ALL_FRAMES_DOCUMENT_START",
        goodsKeyDispatch: "ONE_ASSIGNMENT_PER_COMPATIBLE_GROUP_UP_TO_200",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
        marketplaceCompletionRequired: false,
        liveShoplingVerificationRequired: true,
        manifestSha256,
        popupSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.41-hf78.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-admin-hosts": "kt.shopling.co.kr,a.shopling.co.kr",
      "x-stock-manifest-sha256": manifestSha256,
    },
  });
}
