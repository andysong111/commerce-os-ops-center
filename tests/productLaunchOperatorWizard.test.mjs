import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("manual launch flow keeps approval gated and diagnostics collapsed", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  assert.match(flow, /window\.confirm\("실제 샵플링 상품명\/검색어를 반영합니다\. 계속하시겠습니까\?"\)/);
  assert.match(flow, /<details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><summary[^>]*>개발자 진단 보기/);
  assert.match(flow, /<details className="mt-4"><summary[^>]*>전체 항목 펼쳐보기/);
  assert.match(flow, /runPriceModify\(true\)/);
});
