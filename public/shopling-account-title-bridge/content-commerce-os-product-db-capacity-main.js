(() => {
  "use strict";

  const REQUEST_EVENT = "commerce-os-shopling-product-db-capacity-sync-request";
  const RESULT_EVENT = "commerce-os-shopling-product-db-capacity-sync-result";
  const ENDPOINT =
    "/api/seo-listing-lifecycle/shopling-product-db-capacity-readback";
  let inFlightSnapshotId = "";

  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function validPayload(value) {
    const row = value && typeof value === "object" ? value : {};
    const maximum = Number(row.maximumProductCodeCount);
    const used = Number(row.usedProductCodeCount);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        text(row.snapshotId),
      ) ||
      text(row.source) !== "shopling-plan-dom-v1" ||
      !Number.isSafeInteger(maximum) ||
      maximum <= 0 ||
      !Number.isSafeInteger(used) ||
      used < 0 ||
      !Number.isFinite(Date.parse(text(row.observedAt)))
    ) {
      return null;
    }
    return {
      snapshotId: text(row.snapshotId),
      source: "shopling-plan-dom-v1",
      observedAt: new Date(Date.parse(text(row.observedAt))).toISOString(),
      maximumProductCodeCount: maximum,
      usedProductCodeCount: used,
      evidence:
        row.evidence && typeof row.evidence === "object" ? row.evidence : {},
    };
  }

  window.addEventListener(REQUEST_EVENT, async (event) => {
    const payload = validPayload(
      event instanceof CustomEvent ? event.detail : null,
    );
    if (!payload || payload.snapshotId === inFlightSnapshotId) return;
    inFlightSnapshotId = payload.snapshotId;
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: {
            ok: response.ok && body?.ok === true,
            snapshotId: payload.snapshotId,
          },
        }),
      );
    } finally {
      inFlightSnapshotId = "";
    }
  });
})();
