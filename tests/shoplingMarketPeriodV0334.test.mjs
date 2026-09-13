import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../src/app/api/shopling-market-group-canary/v0334/download/route.ts", import.meta.url);

test("v0.3.34 force-reapplies saved profiles and waits for durable mall-ID selection evidence", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /const VERSION = "0\.3\.34"/);
  assert.match(source, /function forceSelect\(select, pattern\)/);
  assert.match(source, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(source, /function mallIdSelectionEvidence\(\)/);
  assert.match(source, /closest\("form"\) \|\| document/);
  assert.match(source, /visibleCheckedCount/);
  assert.match(source, /totalCheckboxCount/);
  assert.match(source, /looksLikeMaster/);
  assert.match(source, /if \(age < 5000\) return/);
  assert.match(source, /저장검색을 강제 재적용했지만 5초 내 쇼핑몰 ID 선택 증거가 없습니다/);
});

test("v0.3.34 isolates browser runtime and keeps fail-closed submit boundary", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /commerceOsShoplingParallelRunV0334/);
  assert.match(source, /commerceOsShoplingParallelWorkerV0334/);
  assert.match(source, /commerceOsShoplingParallelWorkerMetaV0334/);
  assert.match(source, /commerce-os-shopling-selected-market-start-v0334/);
  assert.match(source, /type: ARM_MESSAGE/);
  assert.match(source, /stage: "submit_armed"/);
  assert.match(source, /if \(!evidence\.selected\.length\)/);
  assert.doesNotMatch(source, /상품명 분산.*자동전송/);
});

test("v0.3.34 force-applies saved profile on both ID-choice and pre-product screens", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /state\.stage === "register_clicked" \|\| state\.stage === "id_choice_ready"/);
  assert.match(source, /state\.stage === "id_choice_submitted" \|\| optionText\(select\) !== task\.profile/);
  assert.match(source, /preprod_saved_profile_apply_failed/);
  assert.match(source, /저장검색 재적용\(change 강제\)/);
});
