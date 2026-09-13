import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0335Package } from "../../v0335/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.36";

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
    ["if (globalThis.__commerceOsShoplingMarketSenderV0335) return;", "if (globalThis.__commerceOsShoplingMarketSenderV0336) return;", "v0336_content_guard_missing"],
    ["globalThis.__commerceOsShoplingMarketSenderV0335 = true;", "globalThis.__commerceOsShoplingMarketSenderV0336 = true;", "v0336_content_guard_set_missing"],
    ['const VERSION = "0.3.35";', 'const VERSION = "0.3.36";', "v0336_content_version_missing"],
    ['const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0335";', 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0336";', "v0336_run_key_missing"],
    ['const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0335";', 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0336";', "v0336_worker_key_missing"],
    ['const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0335";', 'const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0336";', "v0336_selected_start_missing"],
    ['const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0335";', 'const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0336";', "v0336_queue_key_missing"],
    ['const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0335";', 'const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0336";', "v0336_intent_key_missing"],
  ];
  for (const [anchor, replacement, code] of constants) rewritten = replaceRequired(rewritten, anchor, replacement, code);

  rewritten = replaceSection(
    rewritten,
    "  async function drivePreProd(state) {",
    "  async function checkSubmitOutcome(state) {",
    [
      "  async function drivePreProd(state) {",
      "    const task = state.task;",
      "    if (!task || ![\"id_choice_submitted\", \"pre_mapping_ready\", \"arming\"].includes(state.stage)) return;",
      "",
      "    // Proven Shopling manual route (Canary v0.1.2~v0.1.5):",
      "    // ID-choice already fixes the target mall set. This page does not need the 도매/소매 saved-search again.",
      "    // Apply the seven linkage controls directly, then acquire the durable submit lock.",
      "    await sleep(500);",
      "    const mapping = applyPreProdMapping();",
      "    if (!mapping.ok) {",
      "      await failTask(state, \"mapping_controls_missing\", `${task.profile} 연동정보 중 누락: ${mapping.missing.join(\", \")}`);",
      "      return;",
      "    }",
      "    const sendButton = buttons(/^상품등록송신$/i)[0] || buttons(/상품\\s*등록\\s*송신/i)[0];",
      "    if (!sendButton) {",
      "      await failTask(state, \"submit_button_missing\", \"'상품등록송신' 버튼을 찾지 못했습니다.\");",
      "      return;",
      "    }",
      "    await patchWorkerState(state, {",
      "      stage: \"pre_mapping_ready\",",
      "      stepAt: Date.now(),",
      "      message: `${task.profile} · 과거 실전검증된 연동정보 7개 항목 적용 완료`,",
      "    });",
      "    await patchWorkerState(state, {",
      "      stage: \"arming\",",
      "      stepAt: Date.now(),",
      "      message: `${task.profile} 연동정보 검증 완료 · 이 채널의 송신 영구잠금 확인`,",
      "    });",
      "    const arm = await sendMessage({",
      "      type: ARM_MESSAGE,",
      "      runId: state.runId,",
      "      goodsKey: task.goodsKey,",
      "    });",
      "    if (!arm?.ok) {",
      "      await failTask(state, \"submit_lock_failed\", `송신 잠금 실패: ${text(arm?.message || arm?.error)}`);",
      "      return;",
      "    }",
      "    const latest = await getWorkerState(state.runId, task.goodsKey);",
      "    if (!latest || latest.status !== \"running\") return;",
      "    const armed = await patchWorkerState(latest, {",
      "      stage: \"submit_armed\",",
      "      submitArmedAt: Date.now(),",
      "      stepAt: Date.now(),",
      "      message: `${task.profile} 영구잠금 완료 · Shopling 상품등록송신 클릭 직전`,",
      "    });",
      "    if (!armed) return;",
      "    await patchWorkerState(armed, {",
      "      stage: \"submit_clicked\",",
      "      submitClickedAt: Date.now(),",
      "      stepAt: Date.now(),",
      "      message: `${task.profile} · Shopling 상품등록송신 클릭`,",
      "    });",
      "    click(sendButton);",
      "  }",
      "",
    ].join("\n"),
    "v0336_drive_preprod_proven_route",
  );

  if (rewritten.includes("preprod_saved_profile_missing")) {
    throw new Error("v0336_preprod_saved_profile_guard_still_present");
  }
  assertScript("content-v0336", rewritten);
  return rewritten;
}

function rewriteBackground(source: string) {
  const rewritten = replaceRequired(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0335";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0336";',
    "v0336_background_meta_key_missing",
  );
  assertScript("background-v0336", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = replaceRequired(source, 'const VERSION = "0.3.35";', 'const VERSION = "0.3.36";', "v0336_popup_version_missing");
  rewritten = replaceRequired(rewritten, 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0335";', 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0336";', "v0336_popup_start_message_missing");
  rewritten = replaceRequired(rewritten, 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0335";', 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0336";', "v0336_popup_queue_key_missing");
  rewritten = replaceRequired(rewritten, 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0335";', 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0336";', "v0336_popup_intent_key_missing");
  assertScript("popup-v0336", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0335Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0335_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    name?: string;
    short_name?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.35") throw new Error("shopling_market_sender_v0336_source_version_mismatch");

  manifest.version = VERSION;
  manifest.name = "Commerce OS Shopling Market Sender · 기간 미전송 전용";
  manifest.short_name = "Shopling Market Sender";
  manifest.description = "ID 선택 완료 후 연동정보 화면에서 불필요한 도매/소매 저장검색 재탐색을 제거하고, 과거 실전 성공 Canary의 7개 연동 설정을 바로 적용하는 v0.3.36입니다.";

  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(strFromU8(entries["popup.html"]).replaceAll("0.3.35", VERSION));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\nMarket only: title diversification excluded\nPreProd: proven v0.1.5 linkage mapping route restored\nBrowser runtime: fresh v0336 keys\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.36 PROVEN PREPROD ROUTE RESTORE\n` +
      `- 상품명 분산/수정 기능은 포함하지 않습니다.\n` +
      `- ID 선택 화면에서 프로필별 쇼핑몰 행을 직접 체크한 뒤 연동정보 화면으로 이동하는 v0.3.35 동작을 유지합니다.\n` +
      `- 연동정보 화면에서는 도매1~소매2 저장검색을 다시 요구하지 않습니다. 이 페이지는 현재 Shopling에서 해당 저장검색 옵션을 제공하지 않는 것이 운영 화면/원장으로 확인됐습니다.\n` +
      `- 과거 실전 성공 Canary v0.1.2~v0.1.5에서 검증한 7개 설정(쇼핑몰별 판매가/상품명/검색어/옵션명, 상품설명, 매핑 카테고리 및 fallback)을 바로 적용합니다.\n` +
      `- 7개 설정 중 하나라도 식별되지 않으면 송신하지 않고 queued/pending으로 원복합니다.\n` +
      `- 실제 송신 직전 durable submit lock, A18 exact-row 검증, claimEpoch, watchdog, 기간 미전송 기준은 그대로 유지합니다.\n\n` +
      previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.36.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
