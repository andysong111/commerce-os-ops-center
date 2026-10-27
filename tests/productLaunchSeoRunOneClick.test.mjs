import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSeoRunAutoRegistrationPatch,
  shouldAutoQueueShoplingRegistration,
} from "../src/lib/seoRunOneClickRegistration.ts";

test("원클릭 승인 RUN만 SEO 완료 뒤 Shopling 등록큐로 넘어간다", () => {
  assert.equal(shouldAutoQueueShoplingRegistration({ autoQueueShoplingRegistration: true }), true);
  assert.equal(shouldAutoQueueShoplingRegistration({ autoQueueShoplingRegistration: "true" }), false);
  assert.deepEqual(
    buildSeoRunAutoRegistrationPatch(
      { autoQueueShoplingRegistration: true },
      "idle",
      { preserved: true },
      "2026-10-27T00:00:00.000Z",
    ),
    {
      registration_status: "queued",
      registration_payload: {
        preserved: true,
        autoQueuedAt: "2026-10-27T00:00:00.000Z",
        autoQueueSource: "product_launch_tracker_one_click",
      },
    },
  );
});

test("수동 RUN과 이미 처리 중·완료·실패한 등록은 자동 상태변경하지 않는다", () => {
  assert.deepEqual(buildSeoRunAutoRegistrationPatch({}, "idle", {}, "now"), {});
  for (const status of ["submitting", "queued", "running", "success", "failed"]) {
    assert.deepEqual(
      buildSeoRunAutoRegistrationPatch(
        { autoQueueShoplingRegistration: true },
        status,
        {},
        "now",
      ),
      {},
    );
  }
});

test("상품출시 원클릭 버튼은 안전선택·확인 후 RUN별 자동등록 의도를 서버까지 보존한다", async () => {
  const [html, optimized, handoff, durable, route, worker, pulse] = await Promise.all([
    readFile("public/product-launch-tracker-app/index.html", "utf8"),
    readFile("public/product-launch-tracker-app/optimized-app.js", "utf8"),
    readFile("public/product-launch-tracker-app/seo-title-ledger-handoff.js", "utf8"),
    readFile("src/app/seo-bulk-cloud/SeoBulkDurableRunCloudClient.tsx", "utf8"),
    readFile("src/app/api/seo-run-jobs/route.ts", "utf8"),
    readFile("src/lib/seoRunWorker.ts", "utf8"),
    readFile("src/lib/seoRunWorkerPulse.ts", "utf8"),
  ]);

  assert.match(html, /id="seo-shopling-one-click"/);
  assert.match(html, /id="seo-shopling-one-click"[^>]*disabled/);
  assert.match(optimized, /await selectFilteredSeoReadyItems\(\)/);
  assert.match(optimized, /handedOff = true/);
  assert.match(optimized, /product-launch-tracker:seo-shopling-one-click/);
  assert.match(handoff, /window\.confirm\(/);
  assert.match(handoff, /oneClickButton\.disabled = false/);
  assert.match(handoff, /if \(!isOneClickButton\) updateButton\(button\)/);
  assert.match(handoff, /autoQueueShoplingRegistration,/);
  assert.match(durable, /row\.autoQueueShoplingRegistration === true/);
  assert.match(route, /run\.autoQueueShoplingRegistration/);
  assert.match(worker, /buildSeoRunAutoRegistrationPatch/);
  assert.match(pulse, /wakeOpsDispatchTask\("seo-run-worker", 0\)/);
});
