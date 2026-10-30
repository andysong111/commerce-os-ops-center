function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const OPEN_WORKER_HEADER = `  async function openWorkerV030(source, stage, job) {`;

const OWNED_POPUP_HELPERS = `  async function openedFromLauncherHf38(tab, launcherTabId) {
    let current = tab;
    const visited = new Set();
    for (let depth = 0; current && depth < 6; depth += 1) {
      if (!Number.isInteger(current.id) || visited.has(current.id)) return false;
      visited.add(current.id);
      if (current.openerTabId === launcherTabId) return true;
      if (!Number.isInteger(current.openerTabId)) return false;
      current = await chrome.tabs.get(current.openerTabId).catch(() => null);
    }
    return false;
  }

  async function freshOwnedPopupTargetHf38(launcherTabId, baselineTabIds, stage) {
    const exact = [];
    for (const candidate of await shoplingTabs()) {
      if (!Number.isInteger(candidate?.id) || baselineTabIds.has(candidate.id)) continue;
      if (!await openedFromLauncherHf38(candidate, launcherTabId)) continue;
      const target = await targetInTabV030(candidate, stage);
      if (target) exact.push(target);
    }
    if (exact.length > 1) {
      throw new Error(
        String(labels[stage]) + " 새 팝업이 " + String(exact.length) + "개 감지되어 자동 연결을 차단했습니다. " +
        "이번 메뉴 클릭이 연 정확한 창을 하나만 남기고 다시 시도하세요. · HF38_FRESH_POPUP_AMBIGUOUS",
      );
    }
    return exact[0] || null;
  }

  async function openWorkerV030(source, stage, job) {`;

const OPEN_WORKER_LOOP_BEFORE = `    const deadline = Date.now() + 45_000;
    let lastDiag = [];
    while (Date.now() < deadline) {
      const target = await targetInTabV030({ ...tab, windowId: created.id }, stage);
      if (target) return target;
      lastDiag = (await scanFramesV030(tab.id)).map((r) => ({ frameId: r.frameId, ...(r.result || {}) }));
      await clickExactMenuV030(tab.id, stage);
      await sleep(500);
    }
    throw new Error(\`\${labels[stage]} 자동진입 실패 · frame 진단=\${JSON.stringify(lastDiag.slice(0,8))}\`);`;

const OPEN_WORKER_LOOP_AFTER = `    const menuBaselineTabIdsHf38 = new Set((await shoplingTabs()).map((item) => item.id).filter(Number.isInteger));
    const deadline = Date.now() + 45_000;
    let lastDiag = [];
    let menuClickedHf38 = false;
    while (Date.now() < deadline) {
      const target = await targetInTabV030({ ...tab, windowId: created.id }, stage);
      if (target) return target;
      const popupTarget = await freshOwnedPopupTargetHf38(tab.id, menuBaselineTabIdsHf38, stage);
      if (popupTarget) {
        const currentWs = await loadWorkspaceV030();
        const claimedTargetHf38 = {
          ...popupTarget,
          owned: true,
          launcherTabId: tab.id,
          launcherWindowId: created.id,
          claimedAt: Date.now(),
          ownershipPolicy: "HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER",
        };
        currentWs.targets[stage] = claimedTargetHf38;
        await saveWorkspaceV030(currentWs);
        return claimedTargetHf38;
      }
      lastDiag = (await scanFramesV030(tab.id)).map((r) => ({ frameId: r.frameId, ...(r.result || {}) }));
      if (!menuClickedHf38) menuClickedHf38 = await clickExactMenuV030(tab.id, stage);
      await sleep(500);
    }
    throw new Error(
      String(labels[stage]) + " 자동진입 실패 · 새 팝업 연결 정책=HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER · " +
      "frame 진단=" + JSON.stringify(lastDiag.slice(0,8)),
    );`;

export function patchShoplingStockHf38Background(source: string) {
  let background = source.replace(/\r\n/g, "\n");
  background = replaceOnce(
    background,
    OPEN_WORKER_HEADER,
    OWNED_POPUP_HELPERS,
    "shopling_stock_hf38_owned_popup_helpers",
  );
  background = replaceOnce(
    background,
    OPEN_WORKER_LOOP_BEFORE,
    OPEN_WORKER_LOOP_AFTER,
    "shopling_stock_hf38_open_worker_loop",
  );
  return background;
}
