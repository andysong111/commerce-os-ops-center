import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf79OptionClaimSource,
  patchHf79OptionListSource,
  patchHf79SingleClaimSource,
  patchHf79SingleListSource,
} from "@/lib/shoplingStockHf79Patch";
import { GET as getHf78Download } from "../download-hf78/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.41";
const VERSION = "0.6.42";
const HOTFIX = "HF79_KT_POPUP_BACKGROUND_CLAIM_AND_OWNERSHIP";
const OPTION_CLAIM = "background-v050.js";
const OPTION_LIST = "background-v053.js";
const SINGLE_LIST = "background-v056.js";
const SINGLE_CLAIM = "background-v059.js";

type Manifest = {
  manifest_version: number;
  version: string;
  name?: string;
  description?: string;
  background: { service_worker: string };
  action: { default_title?: string; default_popup: string };
  content_scripts: Array<{ js: string[] }>;
};

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf78Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  for (const file of [OPTION_CLAIM, OPTION_LIST, SINGLE_LIST, SINGLE_CLAIM]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf79_base_file_missing:${file}`);
  }
  if (!manifestBytes) throw new Error("shopling_stock_hf79_manifest_missing");

  const manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest;
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf79_manifest_checkpoint_mismatch");
  }

  const optionClaim = patchHf79OptionClaimSource(
    normalized(strFromU8(entries[OPTION_CLAIM])),
  );
  const optionList = patchHf79OptionListSource(
    normalized(strFromU8(entries[OPTION_LIST])),
  );
  const singleList = patchHf79SingleListSource(
    normalized(strFromU8(entries[SINGLE_LIST])),
  );
  const singleClaim = patchHf79SingleClaimSource(
    normalized(strFromU8(entries[SINGLE_CLAIM])),
  );
  for (const source of [optionClaim, optionList, singleList, singleClaim]) {
    new Function(source);
  }

  entries[OPTION_CLAIM] = strToU8(optionClaim);
  entries[OPTION_LIST] = strToU8(optionList);
  entries[SINGLE_LIST] = strToU8(singleList);
  entries[SINGLE_CLAIM] = strToU8(singleClaim);

  const currentPopupPattern =
    "https://kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";
  const guards: Array<[string, string]> = [
    ["optionClaim", optionClaim],
    ["optionList", optionList],
    ["singleList", singleList],
    ["singleClaim", singleClaim],
  ];
  for (const [label, source] of guards) {
    if (!source.includes(currentPopupPattern)) {
      throw new Error(`shopling_stock_hf79_kt_popup_guard_missing:${label}`);
    }
  }
  for (const [label, source] of [
    ["optionClaim", optionClaim],
    ["singleList", singleList],
    ["singleClaim", singleClaim],
  ] as const) {
    if (!source.includes('"https://kt.shopling.co.kr"].includes(parsed.origin)')) {
      throw new Error(`shopling_stock_hf79_kt_origin_guard_missing:${label}`);
    }
  }

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF79";
  manifest.description =
    "HF79 lets the current kt Shopling popup claim its OPTION or SINGLE assignment in the extension background, while preserving exact fresh-popup ownership and grouped goods-key dispatch.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF79`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf79_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    Object.entries({ optionClaim, optionList, singleList, singleClaim }).map(
      ([key, source]) => [
        `${key}Sha256`,
        createHash("sha256").update(source).digest("hex"),
      ],
    ),
  );
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rootCause:
          "KT_POPUP_CONTENT_LOADED_BUT_BACKGROUND_CLAIM_AND_POPUP_QUERIES_REMAINED_A_SHOPLING_ONLY",
        acceptedAdminHosts: ["kt.shopling.co.kr", "a.shopling.co.kr"],
        popupAssignment:
          "OPTION_AND_SINGLE_EXACT_FRESH_POPUP_CLAIM_ON_BOTH_ADMIN_HOSTS",
        goodsKeyDispatch: "GROUPED_BY_TRANSMISSION_KIND_UP_TO_200",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
        marketplaceCompletionRequired: false,
        liveShoplingVerificationRequired: true,
        ...hashes,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.42-hf79.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-claim-hosts": "kt.shopling.co.kr,a.shopling.co.kr",
      "x-stock-option-claim-sha256": String(hashes.optionClaimSha256),
      "x-stock-single-claim-sha256": String(hashes.singleClaimSha256),
    },
  });
}

