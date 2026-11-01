import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf49Download } from "../download-hf49/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.14";
const VERSION = "0.6.15";
const HOTFIX = "HF50_LOGIN_PREFLIGHT_AND_AUDITED_RETRANSMISSION";
const BACKGROUND_OLD = "background-v073.js";
const BACKGROUND_NEW = "background-v074.js";
const CONTENT_OPS = "content-ops-v021.js";

function patchContentOps(source: string) {
  const constantsBefore = '  const APPLY_OPTION_STATUS = "STOCK_SYNC_APPLY_OPTION_STATUS_V054";';
  const constantsAfter = `  const SESSION_PREFLIGHT_REQUEST = "COMMERCE_OS_SHOPLING_STOCK_SYNC_SESSION_PREFLIGHT_REQUEST";
  const SESSION_PREFLIGHT_RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_SESSION_PREFLIGHT_RESULT";
${constantsBefore}`;
  const handlerBefore = '    if (data.type === PING) { void announce(); return; }\n    if (data.type !== START) return;';
  const handlerAfter = `    if (data.type === PING) { void announce(); return; }
    if (data.type === SESSION_PREFLIGHT_REQUEST) {
      const requestId = String(data.requestId || "");
      void chrome.runtime.sendMessage({ type: "STOCK_SYNC_SESSION_PREFLIGHT" })
        .then((response) => post({ type: SESSION_PREFLIGHT_RESULT, requestId, ...(response || { ok: false, code: "SHOPLING_SESSION_PREFLIGHT_NO_RESPONSE", message: "Shopling 로그인 점검 응답이 없습니다." }) }))
        .catch((error) => post({ type: SESSION_PREFLIGHT_RESULT, requestId, ok: false, code: "SHOPLING_SESSION_PREFLIGHT_BRIDGE_FAILED", message: String(error?.message || error || "Shopling 로그인 점검 통신 실패") }));
      return;
    }
    if (data.type !== START) return;`;
  if (!source.includes(constantsBefore) || !source.includes(handlerBefore)) {
    throw new Error("shopling_stock_hf50_content_ops_patch_anchor_missing");
  }
  return source.replace(constantsBefore, constantsAfter).replace(handlerBefore, handlerAfter);
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf49Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const contentBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !contentBytes || !entries[BACKGROUND_OLD]) {
    throw new Error("shopling_stock_hf50_required_entry_missing");
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
    manifest.background.service_worker !== BACKGROUND_OLD
  ) {
    throw new Error("shopling_stock_hf50_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  const content = patchContentOps(strFromU8(contentBytes));
  new Function(background);
  new Function(content);
  for (const guard of [
    "SHOPLING_LOGIN_REQUIRED_BEFORE_START",
    "STOCK_SYNC_SESSION_PREFLIGHT",
    "No Shopling navigation, click, or write",
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf50_background_guard_missing:${guard}`);
  }
  for (const guard of [
    "SESSION_PREFLIGHT_REQUEST",
    "SESSION_PREFLIGHT_RESULT",
    "STOCK_SYNC_SESSION_PREFLIGHT",
  ]) {
    if (!content.includes(guard)) throw new Error(`shopling_stock_hf50_content_guard_missing:${guard}`);
  }

  entries[BACKGROUND_NEW] = strToU8(background);
  entries[CONTENT_OPS] = strToU8(content);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF50";
  manifest.description =
    "HF50 checks for an authenticated Shopling admin tab before Commerce OS records STARTED or launches any stock-state write. It supports audited Shopling-only retransmission without changing inventory history.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF50`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf50_missing_packaged_file:${file}`);
  }
  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    background: createHash("sha256").update(background).digest("hex"),
    contentOps: createHash("sha256").update(content).digest("hex"),
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        loginPreflightBeforeStarted: true,
        loginPreflightReadOnly: true,
        inventoryMutationOnRetransmissionListCreation: false,
        hashes,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="commerce-os-shopling-stock-state-v0.6.15-hf50.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-login-preflight": "required-before-started",
      "x-stock-background-sha256": hashes.background,
      "x-stock-content-ops-sha256": hashes.contentOps,
    },
  });
}
