function versionCore(source: string) {
  return source
    .replaceAll("0.3.42", "0.3.43")
    .replaceAll("V0342", "V0343")
    .replaceAll("v0342", "v0343");
}

export function buildOneClickBackgroundV0343(input: Record<string, string>) {
  const output = { ...input };

  for (const name of [
    "content-group-canary.mjs",
    "background-root.mjs",
    "popup.js",
    "popup.html",
    "recovery.mjs",
    "shopling-market-auto-agent.mjs",
  ]) {
    output[name] = versionCore(output[name]);
  }

  let background = output["background-root.mjs"];
  const blocker = '  if ([MARKET_AUTO_BG_HANDOFF, MARKET_AUTO_BG_TICK, MARKET_AUTO_BG_HEARTBEAT, MARKET_AUTO_BG_REPORT].includes(message.type)) { sendResponse({ ok: false, error: "v0343_manual_period_only" }); return false; }\n';
  if (background.includes(blocker)) background = background.replace(blocker, "");
  if (background.includes("manual_period_only")) {
    throw new Error("v0343_manual_period_guard_still_present");
  }
  output["background-root.mjs"] = background;

  const agent = output["shopling-market-auto-agent.mjs"];
  const content = output["content-group-canary.mjs"];

  for (const marker of [
    "commerceOsShoplingMarketSelectionQueueV0343",
    "commerceOsShoplingMarketSelectionIntentV0343",
  ]) {
    if (!agent.includes(marker) || !content.includes(marker)) {
      throw new Error(`v0343_local_contract_missing:${marker}`);
    }
  }
  if (!agent.includes("commerceOsShoplingMarketAutoActiveV0343")) {
    throw new Error("v0343_active_key_missing");
  }
  if (!agent.includes("__commerceOsShoplingMarketAutoAgentV0343")) {
    throw new Error("v0343_agent_guard_missing");
  }

  for (const stale of [
    "commerceOsShoplingMarketSelectionQueueV0342",
    "commerceOsShoplingMarketSelectionIntentV0342",
    "commerceOsShoplingMarketAutoActiveV0342",
    "__commerceOsShoplingMarketAutoAgentV0342",
  ]) {
    if (agent.includes(stale) || content.includes(stale)) {
      throw new Error(`v0343_stale_local_contract:${stale}`);
    }
  }

  // Server wire compatibility intentionally remains v0330.
  for (const marker of [
    "commerce-os-shopling-market-auto-bg-handoff-v0330",
    "commerce-os-shopling-market-auto-bg-tick-v0330",
    "commerce-os-shopling-market-auto-bg-heartbeat-v0330",
    "commerce-os-shopling-market-auto-bg-report-v0330",
  ]) {
    if (!background.includes(marker) && !agent.includes(marker)) {
      throw new Error(`v0343_stable_protocol_missing:${marker}`);
    }
  }

  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.43";
  manifest.description = "v0.3.42 원클릭 전송의 background manual-period 차단을 제거하고 현재 v0.3.43 queue/intent/active 원장과 A18 전송기를 정렬합니다. 기존 결과회수·중복방지·confirm_needed·최대 3상품/18채널 보호는 유지합니다.";
  manifest.action.default_title = "Shopling Market Sender v0.3.43 · 원클릭 background 복구";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["VERSION.txt"] = "Shopling Market Sender v0.3.43\nOne-click background handoff hotfix published above broken v0.3.42.\nStable v0330 wire protocol retained.\n";
  output["README.txt"] = "v0.3.43 ONE-CLICK BACKGROUND HOTFIX\n- v0.3.42에서 남아 있던 manual-period-only background 차단기를 제거합니다.\n- 원클릭 handoff/tick/heartbeat/report가 실제 background 핸들러에 도달합니다.\n- queue/intent/active 로컬 원장을 V0343으로 맞춥니다.\n- 서버 wire protocol v0330은 호환성을 위해 그대로 유지합니다.\n- A18 프레임 직접연결, 결과회수, 중복방지, confirm_needed fail-closed, 최대 3상품/18채널 정책을 유지합니다.\n";

  for (const name of [
    "content-group-canary.mjs",
    "background-root.mjs",
    "popup.js",
    "recovery.mjs",
    "shopling-market-auto-agent.mjs",
  ]) {
    new Function(output[name]);
  }

  return output;
}
