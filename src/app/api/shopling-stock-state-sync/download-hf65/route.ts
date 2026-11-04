import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf64Download } from "../download-hf64/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.27";
const VERSION = "0.6.28";
const HOTFIX = "HF65_API_FIRST_BCODE_INDEX_AND_READBACK";
const BASE_BACKGROUND = "background-v086.js";
const BACKGROUND = "background-v087.js";
const BASE_OPS = "content-ops-v021.js";
const OPS = "content-ops-v022.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf64Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;
  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !entries[BASE_OPS]) {
    throw new Error("shopling_stock_hf65_base_package_missing");
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
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf65_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, ops] = await Promise.all([
    readFile(path.join(root, BACKGROUND), "utf8").then(normalized),
    readFile(path.join(root, OPS), "utf8").then(normalized),
  ]);
  new Function(background);
  new Function(ops);
  entries[BACKGROUND] = strToU8(background);
  entries[OPS] = strToU8(ops);
  const opsEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_OPS),
  );
  if (!opsEntry) throw new Error("shopling_stock_hf65_ops_entry_missing");
  opsEntry.js = opsEntry.js.map((file) => (file === BASE_OPS ? OPS : file));

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF65";
  manifest.description =
    "HF65 resolves B-codes through a server index, revalidates and changes status through Shopling API, verifies quantity unchanged, then uses only A21 for marketplace transmission.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF65`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf65_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const opsSha256 = createHash("sha256").update(ops).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        bcodeResolution: "SERVER_INDEX_PLUS_LIVE_API_REVALIDATION",
        shoplingMutation: "API_ONLY",
        readback: "API_STATUS_AND_QUANTITY",
        browserStages: ["A21_LIST", "A21_PROCESSING_OR_RESULT"],
        skippedBrowserStages: ["A4", "A6"],
        marketplaceCompletionRequired: false,
        backgroundSha256,
        opsSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.28-hf65.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-api-first": "true",
      "x-stock-browser-stages": "A21-only",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-ops-sha256": opsSha256,
    },
  });
}
