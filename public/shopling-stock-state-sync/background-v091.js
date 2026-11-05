importScripts("background-v090.js");

// HF71 restores the proven top-row radio geometry as a guarded fallback and
// records bounded A21 radio evidence whenever Shopling's visible controls do
// not match the expected three-column transmission layout.
(() => {
  const version = chrome.runtime.getManifest().version;
  console.log(
    "[CommerceOS Stock HF71]",
    new Date().toISOString(),
    "A21 sibling-label and guarded three-column radio locator enabled",
    version,
  );
})();
