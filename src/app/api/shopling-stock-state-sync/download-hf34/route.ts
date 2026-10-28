import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf33Download } from "../download-hf33/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.1";
const VERSION = "0.6.2";
const HOTFIX = "HF34_A6_NAMED_DATE_CONTROLS_BACKGROUND_SAFE";
const STOCK_WORKER = "content-shopling-v030.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const DATE_PAIR_HEADER_BEFORE = `  function datePair(form) {
    const inputs = [...form.querySelectorAll("input")].filter((el) => {`;

const DATE_PAIR_HEADER_AFTER = `  function datePair(form) {
    const namedStarts = [...form.querySelectorAll('input[name="s_dt"], input#s_dt')];
    const namedEnds = [...form.querySelectorAll('input[name="e_dt"], input#e_dt')];
    if (namedStarts.length === 1 && namedEnds.length === 1 && namedStarts[0] !== namedEnds[0]) {
      return [namedStarts[0], namedEnds[0]];
    }
    const inputs = [...form.querySelectorAll("input")].filter((el) => {`;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf33Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[STOCK_WORKER];
  if (!manifestBytes || !workerBytes) {
    throw new Error("shopling_stock_hf34_required_entry_missing");
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
    throw new Error("shopling_stock_hf34_manifest_version_mismatch");
  }

  let worker = strFromU8(workerBytes);
  worker = replaceOnce(
    worker,
    DATE_PAIR_HEADER_BEFORE,
    DATE_PAIR_HEADER_AFTER,
    "shopling_stock_hf34_background_named_date_controls",
  );
  new Function(worker);
  entries[STOCK_WORKER] = strToU8(worker);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF34";
  manifest.description =
    "HF34 verifies the unique A6 s_dt/e_dt controls even in background worker windows while preserving the HF33 exact B-code and option identity guards.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF34`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf34_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        a6RegistrationDateStart: "20220101",
        a6RegistrationDateEnd: "TODAY_KST",
        a6NamedDateControls: ["s_dt", "e_dt"],
        a6NamedDateControlVisibilityRequired: false,
        a6NamedDateControlUniquenessRequired: true,
        hf33ExactBcodeAndIdentityGuardsPreserved: true,
        liveShoplingVerificationRequired: true,
        worker: STOCK_WORKER,
        workerSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf34.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-a6-named-date-visibility-required": "false",
      "x-stock-worker-sha256": workerSha256,
    },
  });
}
