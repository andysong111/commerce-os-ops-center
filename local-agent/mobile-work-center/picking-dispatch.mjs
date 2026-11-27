// Opening this fixed Ops page is only a wake-up. The server grants the
// exact immutable ticket to one authenticated, extension-ready desktop.
export async function wakePickingDispatch(config, fetchImpl = fetch) {
  if (config.allowBusiness !== true) return;
  const origin = new URL(config.endpoint).origin;
  const request = (url, options = {}) =>
    fetchImpl(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      ...options,
    });
  const check = await request(
    origin + "/api/inventory-stock-control/picking-dispatch",
    {
      headers: { Authorization: "Bearer " + config.agentToken },
    },
  );
  if (!check.ok || (await check.json()).pending !== true) return;
  const page = origin + "/china-order-manager/stock-control?pickingDispatch=1";
  const debug = "http://127.0.0.1:9222";
  const list = await request(debug + "/json/list");
  if (!list.ok) return;
  const tabs = await list.json();
  if (
    tabs.some((tab) => {
      if (tab.type !== "page") return false;
      const url = new URL(tab.url);
      return (
        url.href === page ||
        (url.origin === origin &&
          url.pathname === "/login" &&
          url.searchParams.get("next") ===
            new URL(page).pathname + new URL(page).search)
      );
    })
  )
    return;
  await request(debug + "/json/new?" + encodeURIComponent(page), {
    method: "PUT",
  });
}
