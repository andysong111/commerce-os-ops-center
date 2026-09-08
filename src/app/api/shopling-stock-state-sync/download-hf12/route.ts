import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf11Download } from "../download-hf11/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF12_SINGLE_A4_EXACT_FRAME_REUSE_NO_REENTRY_LOOP";
const BACKGROUND_ENTRY = "background-v030.js";
const WORKER_ENTRY = "content-shopling-v030.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const hf11Response = await getHf11Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!hf11Response.ok) return hf11Response;

  const entries = unzipSync(new Uint8Array(await hf11Response.arrayBuffer()));
  const backgroundBytes = entries[BACKGROUND_ENTRY];
  const workerBytes = entries[WORKER_ENTRY];
  const manifestBytes = entries["manifest.json"];
  if (!backgroundBytes || !workerBytes || !manifestBytes) {
    throw new Error("shopling_stock_hf12_required_entry_missing");
  }

  const backgroundBefore = strFromU8(backgroundBytes);
  const workerBefore = strFromU8(workerBytes);

  // Live HF11 failure evidence proved that Shopling had already loaded the authenticated
  // A4 frame at /prod/prodLst.phtml with the 샵플링상품코드 search field, while the old
  // classifier still labelled it OTHER and clicked the menu again every 500 ms.
  // Treat that exact path + exact search option as authoritative A4 evidence.
  const backgroundOld = 'else if (/상품조회수정/i.test(text) && /검색항목/i.test(text)) role = "A4";';
  const backgroundNew = 'else if ((path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) || (/상품조회수정/i.test(text) && /검색항목/i.test(text))) role = "A4";';
  const background = replaceOnce(
    backgroundBefore,
    backgroundOld,
    backgroundNew,
    "shopling_stock_hf12_background_a4_classifier",
  );

  // The content worker must agree with the background classifier. Once the exact A4 URL
  // has loaded, execute there instead of trying to navigate to A4 again. This removes the
  // visible flashing/repeated-search loop without changing A6/A21 or the HF10 OPTION core.
  const workerOld = 'if (/상품조회수정/i.test(text) && !/goods_mallMdfy_trsmt\\.phtml/i.test(href)) return "A4";';
  const workerNew = 'if ((/상품조회수정/i.test(text) || String(location.pathname || "").toLowerCase() === "/prod/prodlst.phtml") && !/goods_mallMdfy_trsmt\\.phtml/i.test(href)) return "A4";';
  const worker = replaceOnce(
    workerBefore,
    workerOld,
    workerNew,
    "shopling_stock_hf12_worker_a4_classifier",
  );

  // Parse now so a malformed hotfix cannot be offered as a downloadable extension.
  new Function(background);
  new Function(worker);
  entries[BACKGROUND_ENTRY] = strToU8(background);
  entries[WORKER_ENTRY] = strToU8(worker);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf12_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v056.js") {
    throw new Error("shopling_stock_hf12_hf11_checkpoint_missing");
  }
  if (!entries["background-v055.js"] || !entries["background-v056.js"] || !entries["content-a21-canonical-v014.js"]) {
    throw new Error("shopling_stock_hf12_locked_option_checkpoint_missing");
  }

  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF12`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes('path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")')) {
    throw new Error("shopling_stock_hf12_background_exact_a4_missing");
  }
  if (!worker.includes('String(location.pathname || "").toLowerCase() === "/prod/prodlst.phtml"')) {
    throw new Error("shopling_stock_hf12_worker_exact_a4_missing");
  }
  if (!background.includes("await clickExactMenuV030(tab.id, stage)")) {
    throw new Error("shopling_stock_hf12_expected_workspace_loop_anchor_missing");
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const workerSha256 = createHash("sha256").update(worker).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      hf10OptionCheckpointPreserved: true,
      hf11SingleA21CheckpointPreserved: true,
      optionA21Execution: "HF10_PRICE_EXTENSION_LITERAL_UNCHANGED",
      singleA4Detection: "EXACT_PROD_LIST_PATH_PLUS_GOODSKEY_SEARCH_OPTION",
      singleA4WorkerDetection: "EXACT_PROD_LIST_PATH_OR_LEGACY_TEXT",
      singleA4RepeatedMenuClickAfterExactLoad: false,
      backgroundEntry: BACKGROUND_ENTRY,
      backgroundSha256,
      workerEntry: WORKER_ENTRY,
      workerSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf12.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-worker-sha256": workerSha256,
    },
  });
}
