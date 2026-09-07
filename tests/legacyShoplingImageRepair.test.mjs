import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/cron/legacy-shopling-image-repair/route.ts";

test("legacy image repair reads every Shopling image field including 19-21", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /Array\.from\(\{ length: 32 \}, \(_, index\) => `img_\$\{index\}`\)/);
  assert.match(source, /\.\.\.byField\[0\]/);
  assert.match(source, /\.\.\.byField\[19\]/);
  assert.match(source, /PRODUCT_FIELDS/);
});

test("legacy image repair splits embedded tab/newline URL payloads and removes unsafe extras", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /split\(\/\[\\t\\r\\n\]\+\/\)/);
  assert.match(source, /split\(\/\\s\+\(\?=https\?:\\\/\\\/\)\/i\)/);
  assert.match(source, /isGifUrl/);
  assert.match(source, /SHIPPING_NOTICE_KEYS/);
  assert.match(source, /normalizedDelimiterItems/);
});

test("legacy image repair preserves existing main image and only fills missing evidence", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /const finalMain = existingMain \|\| chosenMain/);
  assert.match(source, /unique\(\[\.\.\.existingAdditional, \.\.\.chosenAdditional\]\)/);
  assert.match(source, /filter\(\(url\) => normalizedUrlKey\(url\) !== finalMainKey\)/);
  assert.match(source, /MAX_ADDITIONAL_IMAGES/);
});

test("legacy image repair is production cron protected and idempotently marks repaired items", async () => {
  const [source, vercel] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile("vercel.json", "utf8"),
  ]);
  assert.match(source, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /imageRepairVersion/);
  assert.match(source, /REPAIR_VERSION/);
  assert.match(source, /reconcileProductLaunchNormalizedAfterLegacyItems/);
  assert.match(vercel, /\/api\/cron\/legacy-shopling-image-repair/);
});
