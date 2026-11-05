importScripts("background-v089.js");

// HF70 patches the inherited A21 list/popup adapters in the packaged ZIP so
// only the fresh popup opened by the exact current A21 list tab may claim the
// job. The new service-worker entry makes that ownership contract auditable.
(() => {
  const version = chrome.runtime.getManifest().version;
  console.log(
    "[CommerceOS Stock HF70]",
    new Date().toISOString(),
    "exact A21 popup ownership and cell-local radio selection enabled",
    version,
  );
})();
