import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0333Package } from "../../v0333/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.34";

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
    ["if (globalThis.__commerceOsShoplingMarketSenderV0333) return;", "if (globalThis.__commerceOsShoplingMarketSenderV0334) return;", "v0334_content_guard_missing"],
    ["globalThis.__commerceOsShoplingMarketSenderV0333 = true;", "globalThis.__commerceOsShoplingMarketSenderV0334 = true;", "v0334_content_guard_set_missing"],
    ['const VERSION = "0.3.33";', 'const VERSION = "0.3.34";', "v0334_content_version_missing"],
    ['const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0333";', 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV0334";', "v0334_run_key_missing"],
    ['const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0333";', 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0334";', "v0334_worker_key_missing"],
    ['const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0333";', 'const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0334";', "v0334_selected_start_missing"],
    ['const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0333";', 'const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0334";', "v0334_queue_key_missing"],
    ['const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0333";', 'const SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0334";', "v0334_intent_key_missing"],
  ];
  for (const [anchor, replacement, code] of constants) rewritten = replaceRequired(rewritten, anchor, replacement, code);

  rewritten = replaceRequired(
    rewritten,
    [
      "  function setSelect(select, pattern) {",
      "    if (!(select instanceof HTMLSelectElement)) return false;",
      "    const option = [...select.options].find((row) => pattern.test(text(row.textContent)));",
      "    if (!option) return false;",
      "    if (select.value !== option.value) {",
      "      select.value = option.value;",
      "      select.dispatchEvent(new Event(\"input\", { bubbles: true }));",
      "      select.dispatchEvent(new Event(\"change\", { bubbles: true }));",
      "    }",
      "    return true;",
      "  }",
    ].join("\n"),
    [
      "  function setSelect(select, pattern) {",
      "    if (!(select instanceof HTMLSelectElement)) return false;",
      "    const option = [...select.options].find((row) => pattern.test(text(row.textContent)));",
      "    if (!option) return false;",
      "    if (select.value !== option.value) {",
      "      select.value = option.value;",
      "      select.dispatchEvent(new Event(\"input\", { bubbles: true }));",
      "      select.dispatchEvent(new Event(\"change\", { bubbles: true }));",
      "    }",
      "    return true;",
      "  }",
      "",
      "  function forceSelect(select, pattern) {",
      "    if (!(select instanceof HTMLSelectElement)) return false;",
      "    const option = [...select.options].find((row) => pattern.test(text(row.textContent)));",
      "    if (!option) return false;",
      "    select.value = option.value;",
      "    select.dispatchEvent(new Event(\"input\", { bubbles: true }));",
      "    select.dispatchEvent(new Event(\"change\", { bubbles: true }));",
      "    return optionText(select) === text(option.textContent);",
      "  }",
    ].join("\n"),
    "v0334_force_select_anchor_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "  function checkedMallIds() {",
      "    return [...document.querySelectorAll('input[type=\"checkbox\"]:checked:not([disabled])')].filter(visible);",
      "  }",
    ].join("\n"),
    [
      "  function mallIdSelectionEvidence() {",
      "    const selectButton = topSelectButton();",
      "    const scope = selectButton?.closest(\"form\") || document;",
      "    const allCheckboxes = [...scope.querySelectorAll('input[type=\"checkbox\"]:not([disabled])')];",
      "    const checked = allCheckboxes.filter((checkbox) => checkbox.checked);",
      "    const visibleChecked = checked.filter(visible);",
      "    const selected = checked.filter((checkbox) => {",
      "      const label = text(`${controlLabel(checkbox)} ${checkbox.closest(\"tr\")?.textContent || \"\"}`);",
      "      const value = text(checkbox.value);",
      "      const looksLikeMaster = /(?:^|\\s)(전체|모두)\\s*(선택|체크)?(?:\\s|$)/i.test(label)",
      "        && (!value || /^(on|all|1|y|yes)$/i.test(value));",
      "      return !looksLikeMaster;",
      "    });",
      "    return {",
      "      selected,",
      "      checkedCount: checked.length,",
      "      visibleCheckedCount: visibleChecked.length,",
      "      totalCheckboxCount: allCheckboxes.length,",
      "      scopedToSelectForm: Boolean(selectButton?.closest(\"form\")),",
      "    };",
      "  }",
    ].join("\n"),
    "v0334_checked_mall_ids_anchor_missing",
  );

  rewritten = replaceSection(
    rewritten,
    "  async function driveIdChoice(state) {",
    "  async function drivePreProd(state) {",
    [
      "  async function driveIdChoice(state) {",
      "    const task = state.task;",
      "    if (![\"register_clicked\", \"id_profile_selected\", \"id_choice_ready\"].includes(state.stage)) return;",
      "    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);",
      "    const select = savedProfileSelect(task.profile);",
      "    if (!select) {",
      "      await failTask(state, \"saved_profile_select_missing\", `쇼핑몰 ID 선택 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);",
      "      return;",
      "    }",
      "",
      "    if (state.stage === \"register_clicked\" || state.stage === \"id_choice_ready\") {",
      "      const applied = forceSelect(select, profilePattern);",
      "      if (!applied) {",
      "        await failTask(state, \"saved_profile_apply_failed\", `쇼핑몰 ID 선택 화면에서 ${task.profile} 저장검색 강제 적용에 실패했습니다.`);",
      "        return;",
      "      }",
      "      await patchWorkerState(state, {",
      "        stage: \"id_profile_selected\",",
      "        stepAt: Date.now(),",
      "        message: `쇼핑몰 ID 선택 · ${task.profile} 저장검색 재적용(change 강제)`,",
      "      });",
      "      await sleep(1000);",
      "      return;",
      "    }",
      "",
      "    if (optionText(select) !== task.profile) {",
      "      const applied = forceSelect(select, profilePattern);",
      "      if (!applied) {",
      "        await failTask(state, \"saved_profile_apply_failed\", `쇼핑몰 ID 선택 화면에서 ${task.profile} 저장검색 적용에 실패했습니다.`);",
      "        return;",
      "      }",
      "      await patchWorkerState(state, {",
      "        stage: \"id_profile_selected\",",
      "        stepAt: Date.now(),",
      "        message: `쇼핑몰 ID 선택 · ${task.profile} 저장검색 재적용`,",
      "      });",
      "      await sleep(1000);",
      "      return;",
      "    }",
      "",
      "    const evidence = mallIdSelectionEvidence();",
      "    if (!evidence.selected.length) {",
      "      const age = Date.now() - Number(state.stepAt || 0);",
      "      if (age < 5000) return;",
      "      await failTask(",
      "        state,",
      "        \"saved_profile_no_mall_ids\",",
      "        `${task.profile} 저장검색을 강제 재적용했지만 5초 내 쇼핑몰 ID 선택 증거가 없습니다. checked=${evidence.checkedCount} · visibleChecked=${evidence.visibleCheckedCount} · totalCheckboxes=${evidence.totalCheckboxCount} · formScope=${evidence.scopedToSelectForm ? \"yes\" : \"no\"}` ,",
      "      );",
      "      return;",
      "    }",
      "    const selectButton = topSelectButton();",
      "    if (!selectButton) {",
      "      await failTask(state, \"mall_id_select_button_missing\", \"쇼핑몰 ID 선택 화면의 상단 '선택' 버튼을 찾지 못했습니다.\");",
      "      return;",
      "    }",
      "    await patchWorkerState(state, {",
      "      stage: \"id_choice_submitted\",",
      "      stepAt: Date.now(),",
      "      message: `${task.profile} 저장검색 · 쇼핑몰 ID ${evidence.selected.length}개 확인(checked=${evidence.checkedCount}, visible=${evidence.visibleCheckedCount}) · 연동정보 화면 이동`,",
      "    });",
      "    click(selectButton);",
      "  }",
      "",
    ].join("\n"),
    "v0334_drive_id_choice",
  );

  rewritten = replaceSection(
    rewritten,
    "  async function drivePreProd(state) {",
    "  async function checkSubmitOutcome(state) {",
    [
      "  async function drivePreProd(state) {",
      "    const task = state.task;",
      "    if (![\"id_choice_submitted\", \"pre_profile_selected\", \"pre_mapping_ready\", \"arming\"].includes(state.stage)) return;",
      "    const profilePattern = new RegExp(`^${escapeRegex(task.profile)}$`);",
      "    const select = savedProfileSelect(task.profile);",
      "    if (!select) {",
      "      await failTask(state, \"preprod_saved_profile_missing\", `쇼핑몰 연동 정보 화면에서 검색관리 '${task.profile}'을 찾지 못했습니다.`);",
      "      return;",
      "    }",
      "    if (state.stage === \"id_choice_submitted\" || optionText(select) !== task.profile) {",
      "      const applied = forceSelect(select, profilePattern);",
      "      if (!applied) {",
      "        await failTask(state, \"preprod_saved_profile_apply_failed\", `쇼핑몰 연동 정보 화면에서 ${task.profile} 저장검색 적용에 실패했습니다.`);",
      "        return;",
      "      }",
      "      await patchWorkerState(state, {",
      "        stage: \"pre_profile_selected\",",
      "        stepAt: Date.now(),",
      "        message: `쇼핑몰 연동 정보 · ${task.profile} 저장검색 재적용(change 강제)`,",
      "      });",
      "      await sleep(1000);",
      "      return;",
      "    }",
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
    "v0334_drive_preprod",
  );

  assertScript("content-v0334", rewritten);
  return rewritten;
}

function rewriteBackground(source: string) {
  const rewritten = replaceRequired(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0333";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0334";',
    "v0334_background_meta_key_missing",
  );
  assertScript("background-v0334", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = replaceRequired(source, 'const VERSION = "0.3.33";', 'const VERSION = "0.3.34";', "v0334_popup_version_missing");
  rewritten = replaceRequired(rewritten, 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0333";', 'const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0334";', "v0334_popup_start_message_missing");
  rewritten = replaceRequired(rewritten, 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0333";', 'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0334";', "v0334_popup_queue_key_missing");
  rewritten = replaceRequired(rewritten, 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0333";', 'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0334";', "v0334_popup_intent_key_missing");
  assertScript("popup-v0334", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0333Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0333_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    name?: string;
    short_name?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.33") throw new Error("shopling_market_sender_v0334_source_version_mismatch");

  manifest.version = VERSION;
  manifest.name = "Commerce OS Shopling Market Sender · 기간 미전송 전용";
  manifest.short_name = "Shopling Market Sender";
  manifest.description = "Shopling ID 선택/연동정보 화면에서 저장검색 change를 강제 재적용하고 숨은 체크 상태까지 검증한 뒤에만 송신하는 v0.3.34입니다.";

  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(strFromU8(entries["popup.html"]).replaceAll("0.3.33", VERSION));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\nMarket only: title diversification excluded\nSaved profile: forced change + hidden checkbox evidence\nBrowser runtime: fresh v0334 keys\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.34 SAVED-PROFILE SELECTION RECOVERY\n` +
      `- 상품명 분산/수정 기능은 포함하지 않습니다.\n` +
      `- 쇼핑몰 ID 선택 팝업에서 저장검색 값이 이미 같은 값이어도 input/change 이벤트를 강제로 다시 발생시켜 Shopling의 저장검색 적용 로직을 재실행합니다.\n` +
      `- 선택된 쇼핑몰 ID는 보이는 checkbox만 보지 않고 같은 선택 form의 checked DOM 상태까지 확인합니다. 전체선택 전용 checkbox는 ID 증거에서 제외합니다.\n` +
      `- 저장검색 적용 후 최대 5초 동안 실제 ID 선택 증거를 기다리며, 0개면 송신하지 않고 원장에 checked/visible/total 진단값을 남깁니다.\n` +
      `- 연동정보 화면에서도 저장검색 change를 최초 진입 시 강제 재적용해 이전 브라우저 상태에 의존하지 않습니다.\n` +
      `- v0.3.33의 A18 정확행 검증, claimEpoch, submit lock, 2분 watchdog 및 기간 미전송 전용 기준은 그대로 유지합니다.\n\n` +
      previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.34.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
