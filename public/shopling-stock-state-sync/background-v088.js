importScripts("background-v087.js");

// HF67: production now exposes the authenticated admin shell at
// kt.shopling.co.kr while the actual A21 application still lives in an
// a.shopling.co.kr frame/window.  Prepare one owned A21 worker from that shell
// before Commerce OS records STARTED or performs an API status mutation.
(() => {
  const VERSION_V088 = chrome.runtime.getManifest().version;
  const REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT_HF67";
  const WORKSPACE_KEY = "commerceStockWorkspaceV030";
  const ADMIN_MATCHES = [
    "https://kt.shopling.co.kr/*",
    "https://a.shopling.co.kr/*",
  ];
  const MAX_RECENT_TABS = 32;
  const INSPECT_TIMEOUT_MS = 2_500;
  const WORKER_TIMEOUT_MS = 45_000;
  const A21_LABEL = "쇼핑몰상품수정";
  const A21_NUMBER = "21";
  const legacyFindExactRoleTargetV088 = findExactRoleTarget;

  const delayV088 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function recentFirstV088(left, right) {
    if (Boolean(left?.active) !== Boolean(right?.active)) {
      return left?.active ? -1 : 1;
    }
    return Number(right?.lastAccessed || 0) - Number(left?.lastAccessed || 0);
  }

  async function adminTabsV088() {
    const groups = await Promise.all(
      ADMIN_MATCHES.map((url) => chrome.tabs.query({ url }).catch(() => [])),
    );
    const unique = new Map();
    for (const tab of groups.flat()) {
      if (!Number.isInteger(tab?.id)) continue;
      unique.set(tab.id, tab);
    }
    return [...unique.values()].sort(recentFirstV088);
  }

  async function inspectAdminTabV088(tab) {
    if (!Number.isInteger(tab?.id)) return null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), INSPECT_TIMEOUT_MS);
    });
    const inspection = chrome.scripting
      .executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const norm = (value) =>
            String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const compact = (value) => norm(value).replace(/\s+/g, "");
          const text = norm(
            document.body?.innerText ||
              document.body?.textContent ||
              document.documentElement?.innerText ||
              "",
          );
          const options = [...document.querySelectorAll("select option")].map(
            (option) => compact(option.textContent),
          );
          const hasGoodsKey = options.includes(compact("샵플링상품코드"));
          const path = String(location.pathname || "").toLowerCase();
          const authenticated =
            /로그아웃/.test(text) ||
            [...document.querySelectorAll("a[href]")].some((anchor) =>
              /logout/i.test(String(anchor.getAttribute("href") || "")),
            );
          const loginPage =
            /\/login\.phtml/i.test(path) ||
            Boolean(document.querySelector('input[type="password"]'));
          const exactA21 =
            path === "/prodlinkage/goods_prod_join_list.phtml" &&
            hasGoodsKey &&
            /쇼핑몰상품수정/i.test(text) &&
            /상품\s*수정전송/i.test(text);
          const exactMenu = [...document.querySelectorAll(
            'a,button,input[type="button"],input[type="submit"],[onclick]',
          )].some((node) => {
            const value = compact(
              node instanceof HTMLInputElement
                ? `${node.value || ""} ${node.title || ""}`
                : `${node.textContent || ""} ${node.getAttribute?.("title") || ""}`,
            );
            return new Set([
              "쇼핑몰상품수정",
              "[21]쇼핑몰상품수정",
              "[A21]쇼핑몰상품수정",
              "A21쇼핑몰상품수정",
            ]).has(value);
          });
          return {
            authenticated,
            loginPage,
            exactA21,
            exactMenu,
            href: String(location.href || ""),
            title: String(document.title || ""),
          };
        },
      })
      .then((frames) => ({
        tabId: tab.id,
        windowId: tab.windowId,
        url: String(tab.url || tab.pendingUrl || ""),
        active: Boolean(tab.active),
        authenticated: frames.some(
          (frame) => frame.result?.authenticated === true,
        ),
        loginPage: frames.some((frame) => frame.result?.loginPage === true),
        exactMenu: frames.some((frame) => frame.result?.exactMenu === true),
        a21Target: (() => {
          const frame = frames.find((item) => item.result?.exactA21 === true);
          if (!frame) return null;
          return {
            tabId: tab.id,
            windowId: tab.windowId,
            frameId: frame.frameId,
            role: "A21_LIST",
            page: {
              role: "A21_LIST",
              href: frame.result.href,
              title: frame.result.title,
              canNavigate: false,
            },
          };
        })(),
      }))
      .catch(() => null);
    try {
      return await Promise.race([inspection, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function inspectRecentAdminTabsV088() {
    const all = await adminTabsV088();
    const candidates = all.slice(0, MAX_RECENT_TABS);
    return {
      all,
      candidates,
      inspections: await Promise.all(candidates.map(inspectAdminTabV088)),
    };
  }

  async function loadWorkspaceV088() {
    const stored = await chrome.storage.local.get(WORKSPACE_KEY).catch(() => ({}));
    return stored?.[WORKSPACE_KEY] || null;
  }

  async function saveWorkspaceV088(workspace) {
    await chrome.storage.local.set({ [WORKSPACE_KEY]: workspace });
    return workspace;
  }

  async function exactA21TargetV088(tabId) {
    if (!Number.isInteger(tabId)) return null;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    const inspected = await inspectAdminTabV088(tab);
    return inspected?.a21Target || null;
  }

  async function ownedA21TargetV088() {
    const workspace = await loadWorkspaceV088();
    const saved = workspace?.targets?.A21_LIST;
    if (!saved?.owned || !Number.isInteger(saved?.tabId)) return null;
    const target = await exactA21TargetV088(saved.tabId);
    return target ? { ...target, owned: true } : null;
  }

  async function clickExactA21MenuV088(tabId) {
    const rows = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func: (label, number) => {
          const clean = (value) =>
            String(value || "").normalize("NFKC").replace(/\s/g, "");
          const allowed = new Set([
            label,
            `[${number}]${label}`,
            `[A${number}]${label}`,
            `A${number}${label}`,
          ]);
          const nodes = [...document.querySelectorAll(
            'a,button,input[type="button"],input[type="submit"],[onclick]',
          )];
          const matches = nodes.filter((node) => {
            const value = clean(
              node instanceof HTMLInputElement
                ? `${node.value || ""} ${node.title || ""}`
                : `${node.textContent || ""} ${node.getAttribute?.("title") || ""}`,
            );
            return allowed.has(value);
          });
          matches.sort(
            (left, right) =>
              Number(!left.matches("a,[onclick]")) -
                Number(!right.matches("a,[onclick]")) ||
              clean(left.textContent || left.value).length -
                clean(right.textContent || right.value).length,
          );
          const target = matches[0]?.closest?.("a,[onclick]") || matches[0];
          if (!target) return false;
          try {
            target.dispatchEvent(
              new MouseEvent("mouseover", { bubbles: true, view: window }),
            );
          } catch {}
          try {
            target.click();
            return true;
          } catch {
            return false;
          }
        },
        args: [A21_LABEL, A21_NUMBER],
      })
      .catch(() => []);
    return rows.some((row) => row.result === true);
  }

  async function openedFromV088(tab, launcherTabId) {
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

  async function freshOwnedA21TargetV088(launcherTabId, baselineTabIds) {
    const matches = [];
    for (const tab of await adminTabsV088()) {
      if (baselineTabIds.has(tab.id)) continue;
      if (!(await openedFromV088(tab, launcherTabId))) continue;
      const target = await exactA21TargetV088(tab.id);
      if (target) matches.push(target);
    }
    if (matches.length > 1) {
      throw new Error(
        "A21 새 작업창이 2개 이상 감지되어 자동 연결을 차단했습니다.",
      );
    }
    return matches[0] || null;
  }

  async function openOwnedA21WorkerV088(source, baselineTabIds) {
    const created = await chrome.windows.create({
      url: source.url,
      type: "popup",
      width: 1420,
      height: 900,
      focused: false,
    });
    const launcher = created.tabs?.[0];
    if (!Number.isInteger(launcher?.id)) {
      throw new Error("A21 전용 작업창을 만들지 못했습니다.");
    }

    let workspace = {
      executionId: `HF67-PREFLIGHT-${Date.now()}`,
      sourceTabId: source.tabId,
      sourceUrl: source.url,
      baselineTabIds: [...baselineTabIds],
      targets: {
        A21_LIST: {
          tabId: launcher.id,
          windowId: created.id,
          owned: true,
          launcherTabId: launcher.id,
          createdAt: Date.now(),
          ownershipPolicy: "HF67_KT_ADMIN_EXACT_A21_WORKER",
        },
      },
    };
    await saveWorkspaceV088(workspace);

    const deadline = Date.now() + WORKER_TIMEOUT_MS;
    let menuClicked = false;
    while (Date.now() < deadline) {
      const sameTab = await exactA21TargetV088(launcher.id);
      const freshPopup = sameTab
        ? null
        : await freshOwnedA21TargetV088(launcher.id, baselineTabIds);
      const target = sameTab || freshPopup;
      if (target) {
        workspace = {
          ...workspace,
          targets: {
            A21_LIST: {
              ...target,
              owned: true,
              launcherTabId: launcher.id,
              launcherWindowId: created.id,
              claimedAt: Date.now(),
              ownershipPolicy: "HF67_KT_ADMIN_EXACT_A21_WORKER",
            },
          },
        };
        await saveWorkspaceV088(workspace);
        return { ...target, owned: true };
      }
      if (!menuClicked) {
        menuClicked = await clickExactA21MenuV088(launcher.id);
      }
      await delayV088(500);
    }
    throw new Error(
      "로그인은 확인했지만 A21 쇼핑몰상품수정 전용 작업창 자동 준비를 확인하지 못했습니다.",
    );
  }

  async function ensureOwnedA21WorkerV088(source, allTabs) {
    const existing = await ownedA21TargetV088();
    if (existing) return existing;
    return openOwnedA21WorkerV088(
      source,
      new Set(allTabs.map((tab) => tab.id).filter(Number.isInteger)),
    );
  }

  async function preflightV088() {
    const { all, candidates, inspections } = await inspectRecentAdminTabsV088();
    const source = inspections.find(
      (row) => row?.authenticated && row?.exactMenu,
    );
    const authenticated = source || inspections.find((row) => row?.authenticated);
    if (!authenticated) {
      return {
        ok: false,
        authenticated: false,
        code: "SHOPLING_LOGIN_REQUIRED_BEFORE_START",
        message: all.length
          ? "Shopling 로그인 세션이 만료되었습니다. 관리자 메인 탭에서 로그인한 뒤 다시 실행해 주세요. 아직 전송 시작 기록이나 Shopling 변경은 만들지 않았습니다."
          : "로그인된 Shopling 관리자 메인 탭을 1개 열어 주세요. 아직 전송 시작 기록이나 Shopling 변경은 만들지 않았습니다.",
        checkedTabCount: all.length,
        inspectedTabCount: candidates.length,
        loginPageDetected: inspections.some((row) => row?.loginPage),
        acceptedAdminHosts: ["kt.shopling.co.kr", "a.shopling.co.kr"],
      };
    }
    if (!source) {
      return {
        ok: false,
        authenticated: true,
        code: "SHOPLING_ADMIN_MENU_NOT_READY_HF67",
        message:
          "Shopling 로그인은 확인했지만 관리자 메인 메뉴가 아직 준비되지 않았습니다. 메인 화면 로딩이 끝난 뒤 다시 시도해 주세요. 아직 전송 시작 기록이나 Shopling 변경은 만들지 않았습니다.",
        tabId: authenticated.tabId,
        checkedTabCount: all.length,
        inspectedTabCount: candidates.length,
      };
    }
    try {
      const target = await ensureOwnedA21WorkerV088(source, all);
      return {
        ok: true,
        authenticated: true,
        tabId: source.tabId,
        sourceHost: new URL(source.url).hostname,
        a21Ready: true,
        a21TabId: target.tabId,
        a21FrameId: target.frameId,
        checkedTabCount: all.length,
        inspectedTabCount: candidates.length,
        browserStagesPrepared: ["A21_LIST"],
        browserStagesSkipped: ["A4", "A6"],
        noProductMutation: true,
        extensionVersion: VERSION_V088,
      };
    } catch (error) {
      return {
        ok: false,
        authenticated: true,
        code: "SHOPLING_A21_WORKER_PREP_FAILED_HF67",
        message: `${String(error?.message || error)} 아직 전송 시작 기록이나 Shopling 상품상태 변경은 만들지 않았습니다.`,
        tabId: source.tabId,
        checkedTabCount: all.length,
        inspectedTabCount: candidates.length,
        noProductMutation: true,
      };
    }
  }

  findExactRoleTarget = async function findExactRoleTargetV088(stage) {
    if (stage !== "A21_LIST") {
      return legacyFindExactRoleTargetV088(stage);
    }
    return ownedA21TargetV088();
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== REQUEST) return;
    void preflightV088()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          authenticated: false,
          code: "SHOPLING_SESSION_PREFLIGHT_FAILED_HF67",
          message: String(
            error?.message || error || "Shopling 로그인과 A21 준비를 확인하지 못했습니다.",
          ),
        }),
      );
    return true;
  });
})();
