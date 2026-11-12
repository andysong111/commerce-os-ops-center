import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAdminHostV0345,
  isShoplingAdminHostV0345,
} from "../src/lib/shoplingMarketAdminHostV0345.ts";

const oneClick = new URL(
  "../src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx",
  import.meta.url,
);

function fixture() {
  return {
    "manifest.json": JSON.stringify({
      version: "0.3.44",
      action: { default_title: "v0.3.44" },
      content_scripts: [],
    }),
    "content-group-canary.mjs": `
      function isProductListUi() {
        if (location.hostname !== "a.shopling.co.kr") return false;
        return true;
      }
      function isAdminShell() {
        if (location.hostname !== "a.shopling.co.kr" || window.top !== window) return false;
        return true;
      }
    `,
    "background-root.mjs": `
      function isAdminControlUrl(value) {
        const parsed = new URL(value);
        return parsed.hostname === "a.shopling.co.kr"
          && !parsed.pathname.includes("idChoice")
          && !parsed.pathname.includes("preProd");
      }
    `,
    "shopling-market-auto-agent.mjs": `
      (() => {
        if (globalThis.__commerceOsShoplingMarketAutoAgentV0343) return;
        globalThis.__commerceOsShoplingMarketAutoAgentV0330 = true;
      })();
    `,
  };
}

test("allows only the two proven Shopling admin hosts", () => {
  assert.equal(isShoplingAdminHostV0345("a.shopling.co.kr"), true);
  assert.equal(isShoplingAdminHostV0345("kt.shopling.co.kr"), true);
  assert.equal(isShoplingAdminHostV0345("A.SHOPLING.CO.KR"), true);
  assert.equal(isShoplingAdminHostV0345("evil.shopling.co.kr"), false);
  assert.equal(isShoplingAdminHostV0345("shopling.co.kr"), false);
});

test("patches both page gates and the background control gate without widening to every subdomain", () => {
  const output = buildAdminHostV0345(fixture());
  const content = output["content-group-canary.mjs"];
  const background = output["background-root.mjs"];

  assert.equal(JSON.parse(output["manifest.json"]).version, "0.3.45");
  assert.equal((content.match(/kt\.shopling\.co\.kr/g) || []).length, 2);
  assert.match(background, /\["a\.shopling\.co\.kr","kt\.shopling\.co\.kr"\]\.includes\(parsed\.hostname\)/);
  assert.match(background, /!parsed\.pathname\.includes\("idChoice"\)/);
  assert.match(background, /!parsed\.pathname\.includes\("preProd"\)/);
  assert.doesNotMatch(content, /\*\.shopling\.co\.kr/);
  assert.doesNotMatch(background, /endsWith\("\.shopling\.co\.kr"\)/);
});

test("uses the same guard key for agent detection and assignment", () => {
  const agent = buildAdminHostV0345(fixture())["shopling-market-auto-agent.mjs"];
  assert.equal(
    (agent.match(/__commerceOsShoplingMarketAutoAgentV0343/g) || []).length,
    2,
  );
  assert.doesNotMatch(agent, /__commerceOsShoplingMarketAutoAgentV0330/);
});

test("fails closed if the proven host or agent anchors drift", () => {
  const missingHost = fixture();
  missingHost["content-group-canary.mjs"] = "void 0;";
  assert.throws(
    () => buildAdminHostV0345(missingHost),
    /v0345_content_admin_host_guard_mismatch/,
  );

  const missingAgentGuard = fixture();
  missingAgentGuard["shopling-market-auto-agent.mjs"] = "void 0;";
  assert.throws(
    () => buildAdminHostV0345(missingAgentGuard),
    /v0345_agent_guard_assignment_mismatch/,
  );
});

test("one-click UI keeps the KT-compatible package in the latest A19 build", async () => {
  const source = await readFile(oneClick, "utf8");
  assert.match(source, /v0346\/download/);
  assert.match(source, /최신 확장 v0\.3\.46 다운로드/);
  assert.match(source, /Shopling Market Sender v0\.3\.46/);
});
