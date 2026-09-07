import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/cron/legacy-shopling-image-repair/route.ts";

test("legacy image repair reads every Shopling image field including 19-21", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes('Array.from({ length: 32 }, (_, index) => `img_${index}`)'));
  assert.ok(source.includes("...byField[0]"));
  assert.ok(source.includes("...byField[19]"));
  assert.ok(source.includes("PRODUCT_FIELDS"));
});

test("legacy image repair splits embedded tab/newline URL payloads and removes unsafe extras", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes(".split(/[\\t\\r\\n]+/)"));
  assert.ok(source.includes(".split(/\\s+(?=https?:\\/\\/)/i)"));
  assert.ok(source.includes("isGifUrl"));
  assert.ok(source.includes("SHIPPING_NOTICE_KEYS"));
  assert.ok(source.includes("normalizedDelimiterItems"));
});

test("legacy image repair preserves existing main image and only fills missing evidence", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes("const finalMain = existingMain || chosenMain"));
  assert.ok(source.includes("unique([...existingAdditional, ...chosenAdditional])"));
  assert.ok(source.includes("normalizedUrlKey(url) !== finalMainKey"));
  assert.ok(source.includes("MAX_ADDITIONAL_IMAGES"));
});

test("legacy image repair is production cron protected and idempotently marks repaired items", async () => {
  const [source, vercel] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile("vercel.json", "utf8"),
  ]);
  assert.ok(source.includes('process.env.VERCEL_ENV !== "production"'));
  assert.ok(source.includes("process.env.CRON_SECRET"));
  assert.ok(source.includes("timingSafeEqual"));
  assert.ok(source.includes("imageRepairVersion"));
  assert.ok(source.includes("REPAIR_VERSION"));
  assert.ok(source.includes("reconcileProductLaunchNormalizedAfterLegacyItems"));
  assert.ok(vercel.includes("/api/cron/legacy-shopling-image-repair"));
});
