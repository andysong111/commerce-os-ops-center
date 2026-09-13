import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0332Package } from "../../v0332/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.33";

function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(code);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${code}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function replaceSection(source: string, start: string, end: string, replacement: string, code: string) {
  const first = source.indexOf(start);
  if (first < 0) throw new Error(`${code}_start_missing`);
  const after = source.indexOf(end, first + start.length);
  if (after < 0) throw new Error(`${code}_end_missing`);
  if (source.indexOf(start, first + start.length) >= 0) throw new Error(`${code}_start_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(after)}`;
}

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_market_sender_${name}_invalid: ${message}`);
  }
}

function rewriteContent(source: string) {
  let rewritten = source;
  const constants: Array<[string, string, string]> = [
    ["if (globalThis.__commerceOsShoplingMarketSenderV0330) return;", "if (globalThis.__commerceOsShoplingMarketSenderV0333) return;", "v0333_content_guard_missing"],
    ["globalThis.__commerceOsShoplingMarketSenderV0330 = true;", "globalThis.__commerceOsShoplingMarketSenderV0333 = true;", "v0333_content_guard_set_missing"],
    ['const VERSION = "0.3.30";', 'const VERSION = "0.3.33";', "v0333_content_version_missing"],
    ['const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0330";', 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0333";', "v0333_run_key_missing"],
    ['const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0330";', 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0333";', "v0333_worker_key_missing"],
    ['const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0330";', 'const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0333";', "v0333_selected_start_missing"],
    ['const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0330";', 'const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0333";', "v0333_queue_key_missing"],
    ['const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0330";', 'const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0333";', "v0333_intent_key_missing"],
  ];
  for (const [anchor, replacement, code] of constants) rewritten = replaceRequired(rewritten, anchor, replacement, code);

  rewritten = replaceSection(
    rewritten,
    "  async function migrateLegacyRuntimeState() {",
    "  function workerStateKey(runId, goodsKey) {",
    [
      "  async function migrateLegacyRuntimeState() {",
      "    // v0.3.33 intentionally starts with fresh local worker/queue keys.",
      "    // The durable server ledger is authoritative; stale browser runtime state is never revived.",
      "    return {};",
      "  }",
      "",
    ].join("\n"),
    "v0333_content_legacy_runtime_isolation",
  );

  rewritten = replaceSection(
    rewritten,
    "  function rowMatchesExactIdentity(row, task) {",
    "  function checkOnly(entry) {",
    [
      "  function rowMatchesCodeIdentity(row, task) {",
      "    const label = text(row?.innerText || row?.textContent || \"\");",
      "    const code = text(task?.ptnGoodsCd);",
      "    if (!code) return false;",
      "    const codePattern = new RegExp(`(?:^|[^A-Z0-9_])${escapeRegex(code)}(?:[^A-Z0-9_]|$)`, \"i\");",
      "    return codePattern.test(label);",
      "  }",
      "",
      "  function rowHasGoodsKeyEvidence(row, task) {",
      "    const goodsKey = text(task?.goodsKey);",
      "    if (!/^\\d{5,9}$/.test(goodsKey)) return false;",
      "    const evidence = `${text(row?.innerText || row?.textContent || \"\")} ${String(row?.outerHTML || \"\")}`;",
      "    const goodsKeyPattern = new RegExp(`(?:^|\\\\D)${escapeRegex(goodsKey)}(?:\\\\D|$)`);",
      "    return goodsKeyPattern.test(evidence);",
      "  }",
      "",
      "  function productRowEntries(task) {",
      "    return [...document.querySelectorAll(\"tr\")]",
      "      .filter((row) => row.querySelectorAll(\":scope > td\").length >= 3)",
      "      .map((row) => ({ row, checkbox: row.querySelector('input[type=\"checkbox\"]:not([disabled])') }))",
      "      .filter((entry) => entry.checkbox && visible(entry.checkbox) && rowMatchesCodeIdentity(entry.row, task));",
      "  }",
      "",
      "  function exactProductRows(task) {",
      "    return productRowEntries(task)",
      "      .filter((entry) => rowHasGoodsKeyEvidence(entry.row, task))",
      "      .map((entry) => ({ ...entry, identityMode: \"goods_key_dom\" }));",
      "  }",
      "",
      "  function codeOnlyProductRows(task) {",
      "    return productRowEntries(task)",
      "      .map((entry) => ({ ...entry, identityMode: \"single_result_exact_code\" }));",
      "  }",
      "",
    ].join("\n"),
    "v0333_content_row_identity",
  );

  rewritten = replaceSection(
    rewritten,
    "      const rows = exactProductRows(task);",
    "      if (!checkOnly(rows[0])) {",
    [
      "      const age = Date.now() - Number(state.stepAt || 0);",
      "      const body = bodyText();",
      "      const countMatch = body.match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);",
      "      const resultCount = countMatch ? Number(String(countMatch[1]).replace(/,/g, \"\")) || 0 : null;",
      "      const exactRows = exactProductRows(task);",
      "      const codeRows = codeOnlyProductRows(task);",
      "      let rows = exactRows;",
      "      if (rows.length === 0 && resultCount === 1 && codeRows.length === 1) {",
      "        // A18 can keep goods_key in non-visible markup. One total result + one exact ptn_goods_cd row is a safe fallback.",
      "        // Multiple results never use this fallback, so re-upload generations remain fail-closed.",
      "        rows = codeRows;",
      "      }",
      "      if (rows.length === 0) {",
      "        if (resultCount === 0 && age >= 1500) {",
      "          await completeTask(",
      "            state,",
      "            \"already_registered\",",
      "            \"confirmed_zero_unregistered_results\",",
      "            `${task.goodsKey} + ${task.ptnGoodsCd}의 ${task.profile} 미등록 검색 결과가 0건이라 재송신하지 않습니다.`,",
      "          );",
      "          return;",
      "        }",
      "        if (age < UNREGISTERED_RESULT_TIMEOUT_MS) return;",
      "        await failTask(",
      "          state,",
      "          \"unregistered_search_result_not_ready\",",
      "          `${task.profile} 미등록 검색 결과가 ${UNREGISTERED_RESULT_TIMEOUT_MS / 1000}초 안에 안전한 정확일치로 확정되지 않았습니다. 조회수=${resultCount == null ? \"미확인\" : resultCount} · 코드일치행=${codeRows.length} · goods_key DOM일치행=${exactRows.length}`,",
      "        );",
      "        return;",
      "      }",
      "      if (rows.length !== 1) {",
      "        await failTask(state, \"exact_product_identity_ambiguous\", `${task.goodsKey} + ${task.ptnGoodsCd} 안전일치 행이 ${rows.length}개라 이 채널만 중단했습니다. 조회수=${resultCount == null ? \"미확인\" : resultCount}`);",
      "        return;",
      "      }",
    ].join("\n") + "\n",
    "v0333_content_search_identity",
  );

  rewritten = replaceRequired(
    rewritten,
    "        message: `${task.goodsKey} + ${task.ptnGoodsCd} 정확일치 · 등록 팝업 호출`,",
    "        message: `${task.goodsKey} + ${task.ptnGoodsCd} · ${rows[0].identityMode === \"goods_key_dom\" ? \"goods_key DOM 정확일치\" : \"단일결과 자사코드 안전일치\"} · 등록 팝업 호출`,",
    "v0333_content_register_evidence_message_missing",
  );

  assertScript("content-v0333", rewritten);
  return rewritten;
}

function rewriteBackground(source: string) {
  let rewritten = replaceRequired(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0330";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0333";',
    "v0333_background_meta_key_missing",
  );

  rewritten = replaceSection(
    rewritten,
    "function getWorkerMeta() {",
    "function setWorkerMeta(meta) {",
    [
      "function getWorkerMeta() {",
      "  return new Promise((resolve) => {",
      "    chrome.storage.local.get(WORKER_META_KEY, (stored) => {",
      "      void chrome.runtime.lastError;",
      "      resolve(stored?.[WORKER_META_KEY] || null);",
      "    });",
      "  });",
      "}",
      "",
    ].join("\n"),
    "v0333_background_legacy_meta_isolation",
  );

  assertScript("background-v0333", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = replaceRequired(source, 'const VERSION = "0.3.32";', 'const VERSION = "0.3.33";', "v0333_popup_version_missing");
  rewritten = replaceRequired(rewritten, 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0330";', 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0333";', "v0333_popup_start_message_missing");
  rewritten = replaceRequired(rewritten, 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0330";', 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0333";', "v0333_popup_queue_key_missing");
  rewritten = replaceRequired(rewritten, 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0330";', 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0333";', "v0333_popup_intent_key_missing");
  assertScript("popup-v0333", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0332Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0332_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    name?: string;
    short_name?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.32") throw new Error("shopling_market_sender_v0333_source_version_mismatch");

  manifest.version = VERSION;
  manifest.name = "Commerce OS Shopling Market Sender · 기간 미전송 전용";
  manifest.short_name = "Shopling Market Sender";
  manifest.description = "A18 미등록 검색 행의 숨은 goods_key DOM 증거까지 검사하고, 단일 검색결과의 정확 자사상품코드를 안전 fallback으로 허용하는 v0.3.33입니다.";

  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(strFromU8(entries["popup.html"]).replaceAll("0.3.32", VERSION));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\nMarket only: title diversification excluded\nA18 identity: goods_key DOM evidence + single-result exact-code fallback\nBrowser runtime: fresh v0333 keys\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.33 A18 EXACT-ROW RECOVERY\n` +
      `- 상품명 분산/수정 기능은 포함하지 않습니다.\n` +
      `- A18 미등록 검색에서 자사상품코드는 화면 텍스트로 정확일치하고, goods_key는 행의 텍스트뿐 아니라 hidden/input/link/attribute를 포함한 DOM 증거까지 검사합니다.\n` +
      `- goods_key가 A18 행에 노출되지 않더라도 전체 조회수가 정확히 1건이고 자사상품코드 정확일치 행도 1개일 때만 안전 fallback을 허용합니다. 2건 이상이면 자동 송신하지 않습니다.\n` +
      `- 브라우저 로컬 queue/worker/meta key를 v0333으로 분리해 구버전의 죽은 런타임 상태를 새 실행에 재사용하지 않습니다.\n` +
      `- 서버의 submit lock, A18 미등록 사전조회, 2분 pre-submit watchdog, claimEpoch 복구는 그대로 유지합니다.\n\n` +
      previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.33.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
