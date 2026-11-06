const LEGACY_OBSERVER_BOOTSTRAP = `  const observer = new MutationObserver(() => refresh());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["alt", "title", "value"],
  });
  window.addEventListener("load", refresh, { once: true });`;

const SAFE_OBSERVER_BOOTSTRAP = `  const observer = new MutationObserver(() => refresh());
  let observerStarted = false;
  const startObserver = () => {
    if (observerStarted) return true;
    const root = document.documentElement;
    if (!root) return false;
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["alt", "title", "value"],
    });
    observerStarted = true;
    return true;
  };
  if (!startObserver()) {
    window.addEventListener("DOMContentLoaded", startObserver, { once: true });
  }
  window.addEventListener("load", refresh, { once: true });`;

/**
 * HF77 keeps the proven Shopling MAIN-world click bridge alive at
 * `document_start`. Chrome may inject before `document.documentElement`
 * exists; the legacy observer threw there and prevented the click-request
 * listener below it from ever being installed.
 */
export function patchHf77MainWorldSource(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (!normalized.includes(LEGACY_OBSERVER_BOOTSTRAP)) {
    throw new Error("shopling_stock_hf77_legacy_observer_bootstrap_missing");
  }
  const patched = normalized.replace(LEGACY_OBSERVER_BOOTSTRAP, SAFE_OBSERVER_BOOTSTRAP);
  if (patched === normalized || !patched.includes("const startObserver = () =>")) {
    throw new Error("shopling_stock_hf77_main_world_patch_failed");
  }
  return patched;
}
