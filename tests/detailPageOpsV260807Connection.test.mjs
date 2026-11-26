import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [connection, nextConfig, dock] = await Promise.all([
  readFile("src/lib/detailPageStudioConnection.ts", "utf8"),
  readFile("next.config.ts", "utf8"),
  readFile("public/product-launch-tracker-app/detail-page-dock.js", "utf8"),
]);

const OPS_V260807_HOST = "commerce-os-detail-page-studio.vercel.app";

test("product launch tracker is pinned to the configured OPS v260807 Production Studio", () => {
  assert.match(connection, /OPS_CENTER_V260807_STUDIO_URL/);
  assert.ok(connection.includes(OPS_V260807_HOST));
  assert.match(connection, /const OPS_CENTER_V260807_STUDIO_URL = PRODUCTION_STUDIO_URL/);
  assert.match(
    connection,
    /isPreview \|\| isProduction[\s\S]*OPS_CENTER_V260807_STUDIO_URL/,
  );
  assert.ok(nextConfig.includes(OPS_V260807_HOST));
  assert.match(connection, /openaiConfigured !== true/);
  assert.match(connection, /DETAIL_PAGE_STUDIO_OPENAI_NOT_CONFIGURED/);
});

test("selected product launch rows force 1688 link mode and pass seller options", () => {
  assert.match(dock, /url\.searchParams\.set\("ops_dock", "1"\)/);
  assert.match(dock, /url\.searchParams\.set\("source_url", job\.sourceUrl\)/);
  assert.match(
    dock,
    /if \(job\.salesOptions\) url\.searchParams\.set\("sales_options", job\.salesOptions\)/,
  );
  assert.match(dock, /Array\.isArray\(item\?\.orderOptions\)/);
  assert.match(dock, /option\?\.saleOption/);
});

test("tracker generation and full retry pass the production link selected for detail pages", async () => {
  const { chinaLinkUsagePatch, readChinaDetailPageLink } = await import(
    "../public/product-launch-tracker-app/lib/china-product-links.mjs"
  );
  const detailPageUrl = "https://detail.1688.com/offer/222.html";
  const item = chinaLinkUsagePatch({}, {
    commonUrl: "https://detail.1688.com/offer/111.html",
    purchaseUrl: "https://detail.1688.com/offer/333.html",
    detailPageUrl,
    purchaseAlternates: [],
  });
  assert.equal(readChinaDetailPageLink(item), detailPageUrl);
  assert.match(dock, /sourceUrl: readChinaDetailPageLink\(item\)/);
  assert.match(
    dock,
    /const \[latestItem\] = await loadAuthoritativeSelectedItems\(state, \[normalizedItemId\]\);\s*const sourceUrl = readChinaDetailPageLink\(latestItem\);/,
  );
  const compiler = await readFile(
    new URL("../src/components/product-launch-flow/ProductLaunchEvidenceCompilerCanary.tsx", import.meta.url),
    "utf8",
  );
  assert.match(compiler, /const sourceUrl = readChinaDetailPageLink\(item\);/);
});

test("completed detail-page assets dock back to product launch detail fields", () => {
  assert.match(dock, /detailPageAsset:/);
  assert.match(dock, /detailImageUrl,/);
  assert.match(dock, /mainImageUrl,/);
  assert.match(dock, /additionalImageUrls,/);
  assert.match(dock, /html: detailHtml/);
  assert.match(dock, /status: "completed"/);
  assert.match(dock, /stage: "docked"/);
});
