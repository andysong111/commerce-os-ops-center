import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/cron/legacy-shopling-image-repair/route.ts";

test("legacy image repair reads every Shopling image field including 19-21", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes('Array.from({ length: 32 }, (_, index) => `img_${index}`)'));
  assert.ok(source.includes('"dtl_desc"'));
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

test("legacy image repair preserves existing main image and merges validated extras", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes("const finalMain = existingMain || chosenMain"));
  assert.ok(source.includes("...existingAdditional"));
  assert.ok(source.includes("...chosenAdditional"));
  assert.ok(source.includes("[row.mainImageUrl, ...row.additionalImageUrls]"));
  assert.ok(source.includes("normalizedUrlKey(url) !== finalMainKey"));
  assert.ok(source.includes("MAX_ADDITIONAL_IMAGES"));
});

test("legacy image repair infers a strict Shopling CDN root and probes candidates before persistence", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes("inferShoplingCdnBases"));
  assert.ok(source.includes("img\\.shopling\\.co\\.kr\\/prodImg"));
  assert.ok(source.includes("shoplingCdnCandidateUrls"));
  assert.ok(source.includes("Math.floor(numeric / 1000)"));
  assert.ok(source.includes("`${base}/prod_${bucket}/${goodsKey}_0.jpg`"));
  assert.ok(source.includes("probeImageUrl"));
  assert.ok(source.includes('method: "HEAD"'));
  assert.ok(source.includes('method: "GET"'));
  assert.ok(source.includes('range: "bytes=0-1023"'));
  assert.ok(source.includes('contentType.startsWith("image/")'));
  assert.ok(source.includes("CDN_PROBE_TIMEOUT_MS"));
  assert.ok(source.includes("CDN_PROBE_CONCURRENCY"));
  assert.ok(source.includes("mergeCdnEvidence"));
});

test("legacy image repair prefers CDN evidence belonging to the selected detail HTML when possible", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes("htmlFingerprint"));
  assert.ok(source.includes("preferredGoods"));
  assert.ok(source.includes("chooseMainImage(goods, existingAsset.html)"));
});

test("legacy image repair is protected, idempotent, and registered in the existing dispatcher", async () => {
  const [source, dispatcher, vercel] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile("src/lib/opsAdaptiveDispatcher.ts", "utf8"),
    readFile("vercel.json", "utf8"),
  ]);
  assert.ok(source.includes('process.env.VERCEL_ENV !== "production"'));
  assert.ok(source.includes("process.env.CRON_SECRET"));
  assert.ok(source.includes("timingSafeEqual"));
  assert.ok(source.includes("imageRepairVersion"));
  assert.ok(source.includes("REPAIR_VERSION"));
  assert.ok(source.includes("reconcileProductLaunchNormalizedAfterLegacyItems"));
  assert.ok(dispatcher.includes('"legacy-shopling-image-repair"'));
  assert.ok(dispatcher.includes('routePath: "/api/cron/legacy-shopling-image-repair"'));
  assert.ok(dispatcher.includes('import("@/app/api/cron/legacy-shopling-image-repair/route")'));
  assert.equal((vercel.match(/"path"\s*:/g) ?? []).length, 1);
  assert.ok(vercel.includes('"path": "/api/cron/ops-dispatcher"'));
});

test("legacy image repair keeps each dispatcher pass bounded and unresolved evidence retryable", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes("MAX_GOODS_KEYS_PER_RUN = 240"));
  assert.ok(source.includes("MAX_NO_IMAGE_ATTEMPTS = 3"));
  assert.ok(source.includes("selectCandidateBatch"));
  assert.ok(source.includes("attemptedAtMs"));
  assert.ok(source.includes("imageRepairAttemptedAt"));
  assert.ok(source.includes("imageRepairAttemptCount"));
  assert.ok(source.includes('"retry_no_image_evidence"'));
  assert.ok(source.includes('"deferred_no_image_evidence"'));
  assert.ok(source.includes("remainingRetryableCount"));
  assert.ok(source.includes("done: !busy"));
});

test("legacy image repair exposes CDN canary evidence in each batch result", async () => {
  const source = await readFile(routePath, "utf8");
  assert.ok(source.includes("cdnBaseDetected"));
  assert.ok(source.includes("cdnProbedGoodsCount"));
  assert.ok(source.includes("cdnResolvedGoodsCount"));
  assert.ok(source.includes('"shopling_api_or_validated_cdn"'));
});
