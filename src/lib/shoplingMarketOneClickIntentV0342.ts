function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  if (!source.includes(anchor)) throw new Error(code);
  return source.replace(anchor, replacement);
}

function versionCore(source: string) {
  return source
    .replaceAll("0.3.41", "0.3.42")
    .replaceAll("V0341", "V0342")
    .replaceAll("v0341", "v0342");
}

export function buildOneClickIntentV0342(input: Record<string, string>) {
  const output = { ...input };
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "popup.html", "recovery.mjs"]) {
    output[name] = versionCore(output[name]);
  }

  // v0.3.41 inherited a manual-period-only guard that intercepts the durable
  // one-click wire messages before the real handoff/tick/heartbeat/report
  // handlers. v0.3.42 must remove that blocker or the aligned queue/intent
  // keys are never reached in one-click mode.
  let background = output["background-root.mjs"];
  const manualOnlyGuard = '  if ([MARKET_AUTO_BG_HANDOFF, MARKET_AUTO_BG_TICK, MARKET_AUTO_BG_HEARTBEAT, MARKET_AUTO_BG_REPORT].includes(message.type)) { sendResponse({ ok: false, error: "v0342_manual_period_only" }); return false; }\n';
  if (background.includes(manualOnlyGuard)) {
    background = background.replace(manualOnlyGuard, "");
  }
  if (background.includes("v0342_manual_period_only")) {
    throw new Error("v0342_manual_period_guard_still_present");
  }
  output["background-root.mjs"] = background;

  // One-click was introduced in v0.3.30 as a separate content script. Later
  // sender versions advanced the selected queue/intent storage keys, but this
  // script was never versioned. It therefore kept writing V0330 intents while
  // the live v0.3.41 content runner owned V0341, forcing the legacy recovery
  // path instead of the current saved-profile/A18 path. Keep the server handoff
  // protocol v0330 stable, but align only the local storage contract to v0342.
  let agent = output["shopling-market-auto-agent.mjs"];
  if (!agent.includes("globalThis.__commerceOsShoplingMarketAutoAgentV0330")) {
    throw new Error("v0342_auto_agent_guard_anchor_missing");
  }
  agent = agent.replaceAll(
    "globalThis.__commerceOsShoplingMarketAutoAgentV0330",
    "globalThis.__commerceOsShoplingMarketAutoAgentV0342",
  );
  agent = replaceRequired(
    agent,
    'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0330";',
    'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0342";',
    "v0342_auto_queue_key_anchor_missing",
  );
  agent = replaceRequired(
    agent,
    'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0330";',
    'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0342";',
    "v0342_auto_intent_key_anchor_missing",
  );
  agent = replaceRequired(
    agent,
    'const ACTIVE_KEY = "commerceOsShoplingMarketAutoActiveV0330";',
    'const ACTIVE_KEY = "commerceOsShoplingMarketAutoActiveV0342";',
    "v0342_auto_active_key_anchor_missing",
  );
  agent = replaceRequired(
    agent,
    'version: "0.3.30",',
    'version: "0.3.42",',
    "v0342_auto_intent_version_anchor_missing",
  );
  output["shopling-market-auto-agent.mjs"] = agent;

  const content = output["content-group-canary.mjs"];
  if (!content.includes("commerceOsShoplingMarketSelectionQueueV0342")) {
    throw new Error("v0342_content_queue_key_not_current");
  }
  if (!content.includes("commerceOsShoplingMarketSelectionIntentV0342")) {
    throw new Error("v0342_content_intent_key_not_current");
  }
  if (agent.includes("commerceOsShoplingMarketSelectionQueueV0330") ||
      agent.includes("commerceOsShoplingMarketSelectionIntentV0330") ||
      agent.includes("commerceOsShoplingMarketAutoActiveV0330") ||
      agent.includes("__commerceOsShoplingMarketAutoAgentV0330")) {
    throw new Error("v0342_auto_agent_stale_storage_contract");
  }
  // The v0330 wire protocol is intentionally stable: Commerce OS page bridge
  // and background handoff tokens must continue to interoperate after update.
  for (const marker of [
    "commerce-os-shopling-market-auto-bg-handoff-v0330",
    "commerce-os-shopling-market-auto-bg-tick-v0330",
    "commerce-os-shopling-market-auto-bg-heartbeat-v0330",
    "commerce-os-shopling-market-auto-bg-report-v0330",
  ]) {
    if (!background.includes(marker) && !agent.includes(marker)) {
      throw new Error(`v0342_stable_protocol_missing:${marker}`);
    }
  }

  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.42";
  manifest.description = "원클릭 마켓전송이 현재 v0.3.42 queue/intent 원장을 사용하고 durable background handoff를 정상 통과하도록 정렬해 A18 저장 프로필과 쇼핑몰 ID 선택을 최신 전송 경로에서 수행합니다. 결과회수·중복방지·최대 3상품/18채널 정책은 유지합니다.";
  manifest.action.default_title = "Shopling Market Sender v0.3.42 · 원클릭 전송 복구";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["VERSION.txt"] = "Shopling Market Sender v0.3.42\nOne-click handoff now writes the same current queue/intent keys as the live A18 sender and reaches the durable background handlers.\nStable v0330 server handoff protocol retained.\n";
  output["README.txt"] = "v0.3.42 ONE-CLICK CURRENT INTENT FIX\n- 원클릭 에이전트가 더 이상 오래된 V0330 queue/intent 저장소를 사용하지 않습니다.\n- v0.3.42 A18 실행기와 동일한 queue/intent 원장을 사용해 저장 프로필·쇼핑몰 ID 선택·전송을 같은 경로로 처리합니다.\n- v0.3.41에서 상속된 manual-period-only background 차단기를 제거해 handoff/tick/heartbeat/report가 실제 핸들러로 전달됩니다.\n- 서버 handoff 메시지 규격(v0330)은 호환성을 위해 그대로 유지합니다.\n- 쇼핑몰 ID가 실제로 0개이면 submit_armed 전 단계에서 계속 fail-closed 합니다.\n- v0.3.41 결과 URL 자동회수와 post-submit confirm_needed 보호를 유지합니다.\n";

  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "recovery.mjs", "shopling-market-auto-agent.mjs"]) {
    new Function(output[name]);
  }
  return output;
}
