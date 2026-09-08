import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 HF2 exposes legacy Shopling image action labels to the direct A21 click path", async () => {
  const [main, route] = await Promise.all([
    readFile("public/shopling-stock-state-sync/main-shopling.js", "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
  ]);

  assert.match(main, /annotateLegacyA21ActionButtons/);
  assert.match(main, /img\[alt\],img\[title\]/);
  assert.match(main, /상품\\s\*수정전송/);
  assert.match(main, /closest\("a,button,input,\[onclick\]"\)/);
  assert.match(main, /setAttribute\("aria-label", "상품 수정전송"\)/);
  assert.match(main, /MutationObserver/);

  assert.match(route, /button,input\[type=\\"button\\"\],input\[type=\\"submit\\"\],input\[type=\\"image\\"\],a,\[onclick\]/);
  assert.match(route, /PROVEN_A21_LIST_DIRECT_CLICK/);
  assert.match(route, /button\.click\(\)/);
});
