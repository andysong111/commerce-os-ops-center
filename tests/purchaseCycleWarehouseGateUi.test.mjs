import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("purchase preflight explains the automatic warehouse gate without asking for another manual stocktake", async () => {
  const source = await readFile(
    new URL("../src/app/purchase-cycle-preflight/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /title: "창고 자동 판정 확인"/);
  assert.match(source, /sourcingPlan\?\.warehouse\.message/);
  assert.match(source, /href: "\/warehouse-capacity"/);
  assert.match(source, /hrefLabel: "창고 자동 판정 보기"/);
  assert.doesNotMatch(source, /신규상품을 둘 소형·대형 빈자리가 실사 완료 상태인지 확인해야 합니다/);
  assert.doesNotMatch(source, /hrefLabel: "창고·소싱 상태 보기"/);
});
