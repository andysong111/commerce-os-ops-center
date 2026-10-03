import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  shoplingTargets,
  withBrowserCdpTarget,
  withCdpTarget,
} from "./chrome-cdp.mjs";
import {
  CJ_LOIS_NAVIGATION_PROBE_EXPRESSION,
  CJ_LOIS_PAGE_PROBE_EXPRESSION,
  isCjLoisTarget,
} from "./cj-lois-return-pickup-browser-adapter.mjs";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shoplingAccountProbe(account) {
  const marker = `[${clean(account)}]`;
  return `(() => {
    const marker = ${JSON.stringify(marker)};
    return {
      loggedIn: location.pathname !== "/login.phtml"
        && String(document.body?.innerText || "").includes(marker),
      path: location.pathname,
    };
  })()`;
}

async function inspectShoplingTarget(target, account, options = {}) {
  return withCdpTarget(target, async (session) => {
    const results = await evaluateCdpExpressionAcrossFrames(
      session,
      shoplingAccountProbe(account),
      { timeoutMs: options.timeoutMs || 5_000 },
    );
    return results.some((entry) => entry?.value?.loggedIn === true);
  }, { timeoutMs: options.timeoutMs || 5_000 });
}

async function inspectCjTarget(target, options = {}, config = null) {
  const connect = config
    ? (selected, handler, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      handler,
      connectOptions,
    )
    : withCdpTarget;
  return connect(target, async (session) => {
    const evaluate = async (expression) => {
      const result = await session.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }, options.timeoutMs || 5_000);
      return [{
        frame: { id: "", name: "", depth: 0 },
        value: result.result?.value,
      }];
    };
    const pageResults = await evaluate(CJ_LOIS_PAGE_PROBE_EXPRESSION);
    const navigationResults = await evaluate(CJ_LOIS_NAVIGATION_PROBE_EXPRESSION);
    const pageMatches = pageResults.filter((entry) => entry?.value?.isReservationPage === true);
    const authenticatedFrames = navigationResults.filter((entry) => entry?.value?.authenticated === true);
    const navigationTargetCount = navigationResults.reduce(
      (sum, entry) => sum
        + Number(entry?.value?.reservationMenuCount || 0)
        + Number(entry?.value?.reservationEntryCount || 0),
      0,
    );
    return {
      reservationPageReady: pageMatches.length === 1
        && pageMatches[0].value.readyState === "complete",
      authenticated: authenticatedFrames.length > 0,
      navigationReady: authenticatedFrames.length > 0 && navigationTargetCount > 0,
    };
  }, { timeoutMs: options.timeoutMs || 5_000 });
}

export async function runReturnPickupPreflight(config, options = {}, dependencies = {}) {
  const expectedAccount = clean(options.expectedAccount || "andy801");
  const listed = await (dependencies.listChromeTargets || listChromeTargets)(config);
  const allTargets = listed.available ? listed.targets || [] : [];
  const shopling = shoplingTargets(allTargets, config.shoplingOrigins)
    .filter((target) => !/\/login\.phtml(?:[?#]|$)/i.test(target.url));
  const cj = allTargets.filter((target) => isCjLoisTarget(target, config.cjLoisOrigins));
  const inspectShopling = dependencies.inspectShoplingTarget || inspectShoplingTarget;
  const inspectCj = dependencies.inspectCjTarget || inspectCjTarget;

  let shoplingAccountMatches = false;
  for (const target of shopling) {
    if (await inspectShopling(target, expectedAccount, options).catch(() => false)) {
      shoplingAccountMatches = true;
      break;
    }
  }

  const cjInspectionRaw = cj.length === 1
    ? await inspectCj(cj[0], options, config).catch(() => false)
    : false;
  const cjInspection = typeof cjInspectionRaw === "boolean"
    ? { reservationPageReady: cjInspectionRaw, authenticated: cjInspectionRaw, navigationReady: false }
    : cjInspectionRaw || { reservationPageReady: false, authenticated: false, navigationReady: false };
  const cjReservationPageReady = cjInspection.reservationPageReady === true;
  const cjAutoNavigationReady = !cjReservationPageReady
    && cjInspection.authenticated === true
    && cjInspection.navigationReady === true;
  const requiredUserActions = [];
  if (!listed.available) requiredUserActions.push("START_DEDICATED_CHROME");
  if (listed.available && !shopling.length) requiredUserActions.push("LOGIN_SHOPLING_IN_DEDICATED_CHROME");
  else if (listed.available && !shoplingAccountMatches) requiredUserActions.push(`LOGIN_SHOPLING_AS_${expectedAccount}`);
  if (listed.available && cj.length !== 1) requiredUserActions.push("OPEN_ONE_CJ_LOIS_TAB_IN_DEDICATED_CHROME");
  else if (cj.length === 1 && !cjReservationPageReady && !cjAutoNavigationReady) {
    requiredUserActions.push("LOGIN_CJ_LOIS_OR_OPEN_RESERVATION_NAVIGATION");
  }

  return {
    checkedAt: new Date().toISOString(),
    chromeDebugAvailable: listed.available,
    expectedShoplingAccount: expectedAccount,
    shoplingLoggedInTabCount: shopling.length,
    shoplingAccountMatches,
    cjLoisTabCount: cj.length,
    cjReservationPageReady,
    cjAutoNavigationReady,
    readyForDryRun: listed.available
      && shopling.length > 0
      && shoplingAccountMatches
      && cj.length === 1
      && (cjReservationPageReady || cjAutoNavigationReady),
    requiredUserActions,
    externalWritesAllowed: false,
  };
}
