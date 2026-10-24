import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("상품출시 화면은 SEO 재료를 미리 검사한 뒤 같은 계획만 반영한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const control = await readFile(
    new URL(
      "../public/product-launch-tracker-app/seo-material-recovery-control.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(app, /seo-material-recovery-control\.js/);
  assert.match(control, /seo-material-recovery/);
  assert.match(control, /action: "preview"/);
  assert.match(control, /action: "apply"/);
  assert.match(control, /RECOVERY_BATCH_SIZE = 6/);
  assert.match(control, /pageSize: "100"/);
  assert.match(control, /item\?\.readiness\?\.ready === true/);
  assert.match(control, /modelNumbers: list\(batch\?\.modelNumbers\)/);
  assert.match(control, /reportSignature\(latest\) !== text\(batch\?\.signature\)/);
  assert.match(control, /expectedPlanHash: text\(latest\?\.planHash\)/);
  assert.match(control, /확실한 자료만 반영/);
  assert.match(control, /credentials: "same-origin"/);
  assert.doesNotMatch(control, /window\.location\.reload\(\).*requestRecovery/);
});
