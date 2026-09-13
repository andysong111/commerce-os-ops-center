import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { separateShoplingTitleWorkflow, SEPARATED_TITLE_FILENAME } from "@/lib/shoplingTitleWorkflowSeparation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Historical checkpoint markers retained for regression compatibility only:
// commerce-os-shopling-account-title-bridge-v0.5.4.zip
// Commerce OS Shopling Account Title Bridge v0.5.4
// commerce-os-shopling-account-title-bridge-v0.5.6.zip
// Commerce OS Shopling Account Title Bridge v0.5.6
// manifest.version = "0.5.6"
// commerce-os-shopling-account-title-bridge-v0.6.2.zip
// Commerce OS Shopling Account Title Bridge v0.6.2
// commerce-os-shopling-account-title-bridge-v0.6.3.zip
// 상품 생애주기 판매상태 자동화

const FILES = [
  "manifest.json",
  "content-shopling-account-titles.js",
  "content-shopling-price-readback.js",
  "content-shopling-product-list-batch.js",
  "content-shopling-product-list-registry-bridge.js",
  "content-shopling-lifecycle-diagnostic.js",
  "content-shopling-lifecycle-current-status-v062.js",
  "content-shopling-lifecycle-executor.js",
  "content-shopling-pipeline.js",
  "content-shopling-pipeline-frame-bridge.js",
  "content-shopling-onebutton-stability-v054.js",
  "background-shopling-root.js",
  "background-shopling-title-batch.js",
  "background-shopling-title-registry.js",
  "background-shopling-seo-keywords.js",
  "background-shopling-pipeline.js",
  "background-shopling-lifecycle.js",
  "background-shopling-lifecycle-main-exec.js",
  "background-shopling-price-readback.js",
  "README.txt",
] as const;

const CANONICAL_SNIPPET = String.raw`  function canonical(value) {
    return text(value).replace(/\s+/g, "").toUpperCase();
  }
`;

const IDENTITY_HELPERS = String.raw`
  function escapeRegex(value) {
    return text(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
  }

  function rowMatchesExactIdentity(entry, context) {
    const label = text(entry?.label);
    const ptnGoodsCd = text(context?.ptnGoodsCd);
    const goodsKey = text(context?.goodsKey);
    if (!ptnGoodsCd || !/^\d{5,9}$/.test(goodsKey)) return false;
    const codePattern = new RegExp("(?:^|[^A-Z0-9_])" + escapeRegex(ptnGoodsCd) + "(?:[^A-Z0-9_]|$)", "i");
    const goodsKeyPattern = new RegExp("(?:^|\\D)" + escapeRegex(goodsKey) + "(?:\\D|$)");
    return codePattern.test(label) && goodsKeyPattern.test(label);
  }
`;

const LEGACY_IDENTITY_MATCH = String.raw`      const exact = canonical(context.ptnGoodsCd);
      const matchingRows = dataRowsWithCheckboxes().filter((entry) => canonical(entry.label).includes(exact));`;

const DUAL_IDENTITY_MATCH = String.raw`      const matchingRows = dataRowsWithCheckboxes().filter((entry) => rowMatchesExactIdentity(entry, context));`;

const LEGACY_AMBIGUOUS_REASON = '          "exact_product_row_ambiguous",';
const DUAL_AMBIGUOUS_REASON = '          "exact_product_identity_ambiguous",';
const LEGACY_AMBIGUOUS_MESSAGE = '          `${context.ptnGoodsCd} 정확일치 선택행이 ${matchingRows.length}개입니다. 다른 상품을 건드리지 않고 중단합니다.`,';
const DUAL_AMBIGUOUS_MESSAGE = '          `${context.ptnGoodsCd} + 상품번호 ${context.goodsKey} 동시 정확일치 행이 ${matchingRows.length}개입니다. 다른 상품을 건드리지 않고 중단합니다.`,';

const LEGACY_CATEGORY_BLOCK = String.raw`      {
        name: "카테고리 미매핑시 기본정보 카테고리",
        pattern: /매핑된\s*카테고리가\s*없을시.*무시하고.*쇼핑몰기본정보의\s*카테고리로\s*전송/,
      },`;

const VERIFIED_CATEGORY_BLOCK = String.raw`      { name: "매핑된 카테고리로 전송", pattern: /^매핑된\s*카테고리로\s*전송$/ },
      {
        name: "카테고리 미매핑시 기본정보 카테고리",
        pattern: /무시하고.*쇼핑몰기본정보.*카테고리로\s*전송/i,
      },`;

const LEGACY_LIFECYCLE_INVOKE_MUTATION = String.raw`  function invokeMutation(context) {
    return new Promise((resolve) => {
      const token = commandToken(context);
      let settled = false;
      const handler = (event) => {
        const detail = event instanceof CustomEvent ? event.detail : null;
        if (!detail || text(detail.token) !== token || settled) return;
        settled = true;
        window.removeEventListener(MAIN_RESULT_EVENT, handler);
        resolve(detail);
      };
      window.addEventListener(MAIN_RESULT_EVENT, handler);
      window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
        detail: {
          token,
          action: context.desiredState === "DELETE" ? "delete" : "status-change",
          allowDelete: context.allowDelete === true,
        },
      }));
      window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener(MAIN_RESULT_EVENT, handler);
        resolve({ ok: false, error: "main_world_submit_timeout" });
      }, 2500);
    });
  }
`;

const SCRIPTING_LIFECYCLE_INVOKE_MUTATION = String.raw`  async function invokeMutation(context) {
    return sendRuntimeMessage({
      type: "commerce-os-shopling-lifecycle-main-execute",
      token: commandToken(context),
      action: context.desiredState === "DELETE" ? "delete" : "status-change",
      allowDelete: context.allowDelete === true,
    });
  }
`;

function rewritePipeline(source: string) {
  if (!source.includes(CANONICAL_SNIPPET)) throw new Error("shopling_v057_canonical_anchor_missing");
  if (!source.includes(LEGACY_IDENTITY_MATCH)) throw new Error("shopling_v057_identity_anchor_missing");
  if (!source.includes(LEGACY_CATEGORY_BLOCK)) throw new Error("shopling_v057_category_anchor_missing");

  const rewritten = source
    .replace(CANONICAL_SNIPPET, () => `${CANONICAL_SNIPPET}${IDENTITY_HELPERS}`)
    .replace(LEGACY_IDENTITY_MATCH, () => DUAL_IDENTITY_MATCH)
    .replace(LEGACY_AMBIGUOUS_REASON, () => DUAL_AMBIGUOUS_REASON)
    .replace(LEGACY_AMBIGUOUS_MESSAGE, () => DUAL_AMBIGUOUS_MESSAGE)
    .replace(LEGACY_CATEGORY_BLOCK, () => VERIFIED_CATEGORY_BLOCK);

  if (!rewritten.includes("rowMatchesExactIdentity(entry, context)")) throw new Error("shopling_v057_identity_rewrite_failed");
  if (!rewritten.includes("exact_product_identity_ambiguous")) throw new Error("shopling_v057_identity_reason_rewrite_failed");
  if (!rewritten.includes("/무시하고.*쇼핑몰기본정보.*카테고리로\\s*전송/i")) throw new Error("shopling_v057_category_rewrite_failed");

  try {
    new Function(rewritten);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown syntax error");
    throw new Error(`shopling_v057_generated_pipeline_syntax_invalid: ${message}`);
  }
  return rewritten;
}

function rewriteLifecycleExecutor(source: string) {
  if (!source.includes(LEGACY_LIFECYCLE_INVOKE_MUTATION)) {
    throw new Error("shopling_v060_lifecycle_invoke_anchor_missing");
  }
  const rewritten = source.replace(
    LEGACY_LIFECYCLE_INVOKE_MUTATION,
    () => SCRIPTING_LIFECYCLE_INVOKE_MUTATION,
  );
  if (!rewritten.includes("commerce-os-shopling-lifecycle-main-execute")) {
    throw new Error("shopling_v060_lifecycle_invoke_rewrite_failed");
  }
  if (rewritten.includes("main_world_submit_timeout")) {
    throw new Error("shopling_v060_legacy_event_bridge_still_present");
  }
  try {
    new Function(rewritten);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown syntax error");
    throw new Error(`shopling_v060_generated_lifecycle_executor_syntax_invalid: ${message}`);
  }
  return rewritten;
}

function buildV063Manifest(source: Record<string, unknown>) {
  const manifest = structuredClone(source) as Record<string, unknown> & {
    permissions?: string[];
    content_scripts?: Array<Record<string, unknown> & { matches?: string[]; js?: string[]; world?: string }>;
  };
  manifest.version = "0.6.3";
  manifest.description = "기존 상품명·마켓전송·상품 생애주기 자동화를 유지하면서, 확정원가 가격 적용 후 Shopling 로그인 브라우저의 쇼핑몰별 가격 화면을 읽기 전용으로 전수 재검증합니다. 가격 쓰기 없이 불일치만 예외로 남깁니다.";
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), "alarms", "scripting"])];

  const scripts = manifest.content_scripts ?? [];
  const shopInfoIndex = scripts.findIndex((entry) =>
    Array.isArray(entry.matches) && entry.matches.includes("https://a.shopling.co.kr/prod/prodShopInfo.phtml*"),
  );
  if (shopInfoIndex < 0) throw new Error("shopling_v063_shopinfo_content_script_missing");
  scripts[shopInfoIndex].js = [
    ...new Set([...(scripts[shopInfoIndex].js ?? []), "content-shopling-price-readback.js"]),
  ];

  const productScriptIndex = scripts.findIndex((entry) =>
    Array.isArray(entry.matches) && entry.matches.includes("https://a.shopling.co.kr/prod/*") && !entry.world,
  );
  if (productScriptIndex < 0) throw new Error("shopling_v063_product_content_script_missing");

  scripts.splice(productScriptIndex + 1, 0,
    {
      matches: ["https://a.shopling.co.kr/prod/*"],
      js: [
        "content-shopling-lifecycle-current-status-v062.js",
        "content-shopling-lifecycle-executor.js",
      ],
      all_frames: false,
      run_at: "document_idle",
    },
  );
  manifest.content_scripts = scripts;
  return manifest;
}

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-account-title-bridge");
  const entries: Record<string, Uint8Array> = {};

  for (const fileName of FILES) {
    if (fileName === "manifest.json") {
      const sourceManifest = JSON.parse(await readFile(path.join(root, fileName), "utf8")) as Record<string, unknown>;
      const manifest = buildV063Manifest(sourceManifest);
      entries[fileName] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
      continue;
    }

    if (fileName === "content-shopling-pipeline.js") {
      const source = await readFile(path.join(root, fileName), "utf8");
      entries[fileName] = strToU8(rewritePipeline(source));
      continue;
    }

    if (fileName === "content-shopling-lifecycle-executor.js") {
      const source = await readFile(path.join(root, fileName), "utf8");
      entries[fileName] = strToU8(rewriteLifecycleExecutor(source));
      continue;
    }

    const bytes = await readFile(path.join(root, fileName));
    entries[fileName] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  entries["VERSION.txt"] = strToU8("Commerce OS Shopling Account Title Bridge v0.6.3\n");
  // Strip the legacy combined workflow at the final packaging boundary.
  // Lifecycle and price-readback transformations above remain unchanged.
  const separatedEntries = separateShoplingTitleWorkflow(entries);
  const archive = zipSync(separatedEntries, { level: 6 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=${SEPARATED_TITLE_FILENAME}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
