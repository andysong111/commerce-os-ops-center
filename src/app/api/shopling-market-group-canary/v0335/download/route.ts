import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0334Package } from "../../v0334/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.35";

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
    ["if (globalThis.__commerceOsShoplingMarketSenderV0334) return;", "if (globalThis.__commerceOsShoplingMarketSenderV0335) return;", "v0335_content_guard_missing"],
    ["globalThis.__commerceOsShoplingMarketSenderV0334 = true;", "globalThis.__commerceOsShoplingMarketSenderV0335 = true;", "v0335_content_guard_set_missing"],
    ['const VERSION = "0.3.34";', 'const VERSION = "0.3.35";', "v0335_content_version_missing"],
    ['const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0334";', 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0335";', "v0335_run_key_missing"],
    ['const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0334";', 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0335";', "v0335_worker_key_missing"],
    ['const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0334";', 'const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0335";', "v0335_selected_start_missing"],
    ['const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0334";', 'const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0335";', "v0335_queue_key_missing"],
    ['const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0334";', 'const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0335";', "v0335_intent_key_missing"],
  ];
  for (const [anchor, replacement, code] of constants) rewritten = replaceRequired(rewritten, anchor, replacement, code);

  rewritten = replaceSection(
    rewritten,
    "  function mallIdSelectionEvidence() {",
    "  function topSelectButton() {",
    [
      "  function mallIdConfirmButton() {",
      "    const candidates = [...document.querySelectorAll('button, input[type=\"button\"], input[type=\"submit\"]')]",
      "      .filter(visible)",
      "      .filter((element) => !element.disabled)",
      "      .filter((element) => /^선택$/i.test(buttonText(element)))",
      "      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);",
      "    return candidates[0] || null;",
      "  }",
      "",
      "  function mallIdCheckboxes() {",
      "    const confirmButton = mallIdConfirmButton();",
      "    const scope = confirmButton?.closest(\"form\") || document;",
      "    return [...scope.querySelectorAll('input[type=\"checkbox\"]:not([disabled])')].filter((checkbox) => {",
      "      const label = text(`${controlLabel(checkbox)} ${checkbox.closest(\"tr\")?.textContent || \"\"}`);",
      "      const value = text(checkbox.value);",
      "      const looksLikeMaster = /(?:^|\\s)(전체|모두)\\s*(선택|체크)?(?:\\s|$)/i.test(label)",
      "        && (!value || /^(on|all|1|y|yes)$/i.test(value));",
      "      return !looksLikeMaster;",
      "    });",
      "  }",
      "",
      "  function ensureMallIdsChecked() {",
      "    const checkboxes = mallIdCheckboxes();",
      "    for (const checkbox of checkboxes) {",
      "      if (checkbox.checked) continue;",
      "      try { checkbox.click(); } catch { /* property fallback below */ }",
      "      if (!checkbox.checked) {",
      "        checkbox.checked = true;",
      "        checkbox.dispatchEvent(new Event(\"input\", { bubbles: true }));",
      "        checkbox.dispatchEvent(new Event(\"change\", { bubbles: true }));",
      "      }",
      "    }",
      "    const selected = checkboxes.filter((checkbox) => checkbox.checked);",
      "    const visibleSelected = selected.filter(visible);",
      "    return {",
      "      checkboxes,",
      "      selected,",
      "      selectedCount: selected.length,",
      "      visibleSelectedCount: visibleSelected.length,",
      "      totalCheckboxCount: checkboxes.length,",
      "      scopedToConfirmForm: Boolean(mallIdConfirmButton()?.closest(\"form\")),",
      "    };",
      "  }",
      "",
    ].join("\n"),
    "v0335_mall_checkbox_helpers",
  );

  rewritten = replaceSection(
    rewritten,
    "  async function driveIdChoice(state) {",
    "  async function drivePreProd(state) {",
    [
      "  async function driveIdChoice(state) {",
      "    const task = state.task;",
      "    if (![\"register_clicked\", \"id_profile_selected\"].includes(state.stage)) return;",
      "    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);",
      "    const select = savedProfileSelect(task.profile);",
      "    if (!select) {",
      "      await failTask(state, \"saved_profile_select_missing\", `쇼핑몰 ID 선택 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);",
      "      return;",
      "    }",
      "",
      "    if (state.stage === \"register_clicked\") {",
      "      const applied = forceSelect(select, profilePattern);",
      "      if (!applied) {",
      "        await failTask(state, \"saved_profile_apply_failed\", `쇼핑몰 ID 선택 화면에서 ${task.profile} 저장검색 적용에 실패했습니다.`);",
      "        return;",
      "      }",
      "      await patchWorkerState(state, {",
      "        stage: \"id_profile_selected\",",
      "        stepAt: Date.now(),",
      "        message: `쇼핑몰 ID 선택 · ${task.profile} 행 필터 적용 · 실제 쇼핑몰 체크박스 선택 대기`,",
      "      });",
      "      return;",
      "    }",
      "",
      "    const age = Date.now() - Number(state.stepAt || 0);",
      "    if (age < 800) return;",
      "    const evidence = ensureMallIdsChecked();",
      "    if (!evidence.totalCheckboxCount) {",
      "      if (age < 5000) return;",
      "      await failTask(",
      "        state,",
      "        \"saved_profile_no_mall_rows\",",
      "        `${task.profile} 필터 적용 후 5초 내 선택 가능한 쇼핑몰 ID 행이 나타나지 않았습니다.`,",
      "      );",
      "      return;",
      "    }",
      "    if (evidence.selectedCount !== evidence.totalCheckboxCount) {",
      "      await failTask(",
      "        state,",
      "        \"mall_id_checkbox_selection_failed\",",
      "        `${task.profile} 쇼핑몰 ID ${evidence.totalCheckboxCount}개 중 ${evidence.selectedCount}개만 체크되어 송신하지 않습니다. visibleSelected=${evidence.visibleSelectedCount} · formScope=${evidence.scopedToConfirmForm ? \"yes\" : \"no\"}`,",
      "      );",
      "      return;",
      "    }",
      "    const confirmButton = mallIdConfirmButton();",
      "    if (!confirmButton) {",
      "      await failTask(state, \"mall_id_confirm_button_missing\", \"쇼핑몰 ID 선택 화면의 하단 '선택' 버튼을 찾지 못했습니다.\");",
      "      return;",
      "    }",
      "    await patchWorkerState(state, {",
      "      stage: \"id_choice_submitted\",",
      "      stepAt: Date.now(),",
      "      message: `${task.profile} · 필터된 쇼핑몰 ID ${evidence.selectedCount}개 직접 체크 검증 완료 · 하단 선택으로 연동정보 이동`,",
      "    });",
      "    click(confirmButton);",
      "  }",
      "",
    ].join("\n"),
    "v0335_drive_id_choice",
  );

  assertScript("content-v0335", rewritten);
  return rewritten;
}

function rewriteBackground(source: string) {
  const rewritten = replaceRequired(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0334";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0335";',
    "v0335_background_meta_key_missing",
  );
  assertScript("background-v0335", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = replaceRequired(source, 'const VERSION = "0.3.34";', 'const VERSION = "0.3.35";', "v0335_popup_version_missing");
  rewritten = replaceRequired(rewritten, 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0334";', 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0335";', "v0335_popup_start_message_missing");
  rewritten = replaceRequired(rewritten, 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0334";', 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0335";', "v0335_popup_queue_key_missing");
  rewritten = replaceRequired(rewritten, 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0334";', 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0335";', "v0335_popup_intent_key_missing");
  assertScript("popup-v0335", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0334Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0334_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    name?: string;
    short_name?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.34") throw new Error("shopling_market_sender_v0335_source_version_mismatch");

  manifest.version = VERSION;
  manifest.name = "Commerce OS Shopling Market Sender · 기간 미전송 전용";
  manifest.short_name = "Shopling Market Sender";
  manifest.description = "저장검색으로 필터된 Shopling 쇼핑몰 ID 행의 체크박스를 직접 전부 선택·재검증한 뒤 하단 선택 버튼으로만 진행하는 v0.3.35입니다.";

  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(strFromU8(entries["popup.html"]).replaceAll("0.3.34", VERSION));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\nMarket only: title diversification excluded\nMall IDs: filtered rows are explicitly checked before confirmation\nBrowser runtime: fresh v0335 keys\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.35 MALL-ID CHECKBOX RECOVERY\n` +
      `- 상품명 분산/수정 기능은 포함하지 않습니다.\n` +
      `- 저장검색 프로필은 쇼핑몰 ID 행을 필터링하는 기준으로만 사용합니다. 저장검색이 체크 상태까지 만들어 준다고 가정하지 않습니다.\n` +
      `- 프로필 적용 후 같은 form의 실제 쇼핑몰 ID 체크박스를 확장프로그램이 직접 모두 체크하고, 전체 체크 성공을 다시 검증합니다.\n` +
      `- 체크가 하나라도 실패하면 송신하지 않고 해당 채널만 queued/pending으로 안전 원복합니다.\n` +
      `- 확인은 버튼/input 형태의 '선택' 중 화면 최하단 버튼만 사용해 상단 필터/헤더 컨트롤과 혼동하지 않습니다.\n` +
      `- v0.3.34의 A18 exact-row, 저장검색 강제 change, submit lock, claimEpoch, watchdog, 기간 미전송 기준은 유지합니다.\n\n` +
      previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.35.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
