const pageParams = new URLSearchParams(window.location.search);
const detailPageMode = pageParams.get("detail_page_mode") || "standalone";
const dockEventSource = "commerce-os-detail-page-dock";
const workAssistantSource = "commerce-os-work-assistant";
const detailJobsActiveApi = "/api/product-launch-tracker/detail-page-jobs/active";
const workerIdleCheckMs = 30_000;

document.documentElement.dataset.productLaunchArchitecture = "v2-core-first";

function signalDetailPageWorkerReady() {
  window.parent?.postMessage(
    {
      source: dockEventSource,
      type: "detail-page-worker-ready",
    },
    window.location.origin,
  );
}

if (detailPageMode === "worker") {
  let workerModulesPromise = null;
  let workerCheckTimer = null;

  const ensureWorkerModules = () => {
    if (!workerModulesPromise) {
      workerModulesPromise = (async () => {
        await import("./detail-page-product-scope.js");
        await import("./detail-page-dock.js");
        await import("./detail-page-bgrade-main-only-dock.js");
        await import("./detail-page-dock-repair.js");
      })();
    }
    return workerModulesPromise;
  };

  const scheduleWorkerCheck = (delay = 800) => {
    window.clearTimeout(workerCheckTimer);
    workerCheckTimer = window.setTimeout(async () => {
      if (workerModulesPromise) return;
      try {
        const response = await fetch(detailJobsActiveApi, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.ok === true && payload?.active === true) {
          await ensureWorkerModules();
          return;
        }
      } catch {
        // Active-job probing is intentionally lightweight and retries later.
      }
      scheduleWorkerCheck(workerIdleCheckMs);
    }, delay);
  };

  signalDetailPageWorkerReady();
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const payload = event.data;
    if (payload?.source !== workAssistantSource) return;
    if (payload?.type === "detail-page-worker-ping") {
      signalDetailPageWorkerReady();
      return;
    }
    if (payload?.__commerceWorkerBootstrapForwarded === true) return;
    if (
      payload?.type !== "activate-detail-page-job" &&
      payload?.type !== "retry-detail-page-job"
    ) {
      return;
    }

    void ensureWorkerModules().then(() => {
      const forwarded = {
        ...payload,
        __commerceWorkerBootstrapForwarded: true,
      };
      window.dispatchEvent(
        new MessageEvent("message", {
          data: forwarded,
          origin: window.location.origin,
          source: window.parent,
        }),
      );
    });
  });
  scheduleWorkerCheck();
} else {
  try {
    const startupPreview = await import("./startup-page-cache-preview.js");
    startupPreview.installStartupPageCachePreview?.();
  } catch (error) {
    console.error("Product launch startup cache preview failed", error);
  }

  // Product Master is the durable product authority. Mount its control plane first so
  // the operator sees the product ledger even while OPS Workflow is unavailable.
  try {
    await import("./product-master-control-plane.js");
  } catch (error) {
    console.error("Product Master control plane failed to load", error);
  }

  // OPS Workflow is a secondary layer. Do not mount optimized-app until a bounded
  // health probe succeeds, otherwise its skeleton/error UI can overwrite Product Master.
  try {
    const workflowGate = await import("./workflow-ui-gate.js");
    workflowGate.installWorkflowUiGate?.();
  } catch (error) {
    console.error("OPS Workflow UI gate failed to load", error);
  }

  // Product and purchase metadata integrations stay available with the main read model.
  await import("./optimized-china-order-mapping.js");
  await import("./model-bcode-option-guard.js");
  await import("./china-option-table-authority.js");
  await import("./purchase-metadata-auto-sync.js");

  // Lightweight table behavior is available immediately. Detail-page job modules are
  // intentionally not mounted here; they load only when the operator opens a detail flow.
  await import("./table-horizontal-scroll.js");
  await import("./dialog-close-fix.js");
  await import("./table-inline-ops-loader.js");
  await import("./table-frozen-columns-fix.js");
  await import("./empty-cell-placeholder-cleanup.js");
  await import("./shopling-upload-ui.js");
  await import("./product-launch-flow-handoff.js");
  await import("./seo-fallback-cache-selection.js");
  await import("./seo-title-ledger-handoff.js?v=20260916-source-chain-v1");

  installLazyDetailPageIntegrations();
  scheduleIdleIntegrations();
}

function installLazyDetailPageIntegrations() {
  let modulesPromise = null;
  let observer = null;

  const start = () => {
    if (!modulesPromise) {
      modulesPromise = (async () => {
        const modules = [
          "./detail-page-product-scope.js",
          "./detail-page-dock.js",
          "./detail-page-bgrade-main-only-dock.js",
          "./detail-page-dock-repair.js",
          "./detail-page-option-guard.js",
        ];
        for (const path of modules) {
          try {
            await import(path);
          } catch (error) {
            console.error(`Detail-page integration failed to load: ${path}`, error);
          }
        }
      })();
    }
    return modulesPromise;
  };

  const eagerStart = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "button[data-action='detail'], button[data-action='preview'], #preview-button, #add-items-button, #detail-dialog",
      )
    ) {
      void start();
    }
  };
  document.addEventListener("pointerdown", eagerStart, true);

  const detailDialog = document.querySelector("#detail-dialog");
  if (detailDialog) {
    observer = new MutationObserver(() => {
      if (detailDialog.hasAttribute("open")) void start();
    });
    observer.observe(detailDialog, { attributes: true, attributeFilter: ["open"] });
    if (detailDialog.hasAttribute("open")) void start();
  }

  if (pageParams.get("detailPageItem") || pageParams.get("open_item")) {
    void start();
  }

  window.addEventListener(
    "pagehide",
    () => {
      document.removeEventListener("pointerdown", eagerStart, true);
      observer?.disconnect();
    },
    { once: true },
  );
}

function scheduleIdleIntegrations() {
  let started = false;
  const eagerStart = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "#bulk-apply-button, #export-menu-button, #policy-button, button[data-action='detail'], button[data-action='preview']",
      )
    ) {
      start();
    }
  };
  const start = () => {
    if (started) return;
    started = true;
    document.removeEventListener("pointerdown", eagerStart, true);
    void loadIdleIntegrations();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 1_200 });
  } else {
    window.setTimeout(start, 250);
  }
  document.addEventListener("pointerdown", eagerStart, true);
}

async function loadIdleIntegrations() {
  const modules = [
    "./category-ai.js",
    "./category-ai-reliable.js",
    "./category-review-queue-link.js",
    "./category-toolbar-layout.js",
    "./category-local-upload-payload.js",
    "./category-local-health-recovery.js",
    "./category-local-update.js",
    "./category-local-result-recovery.js",
    "./category-update-progress.js",
    "./category-update-cancel-guard.js",
    "./category-update-work-assistant-bridge.js",
  ];
  for (const path of modules) {
    try {
      await import(path);
    } catch (error) {
      console.error(`Product launch integration failed to load: ${path}`, error);
    }
  }
}
