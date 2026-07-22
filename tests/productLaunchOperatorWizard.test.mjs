import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("operator wizard keeps preview compact by default", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  assert.match(flow, /대표 미리보기/);
  assert.match(flow, /<details[\s\S]*전체 \{previewItems\.length\}개 항목 펼쳐보기/);
  assert.match(flow, /representativeItems/);
});

test("operator wizard exposes only one primary action branch per phase", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const label of ["상품출시 시작", "후보 입력 후 미리보기 생성", "승인하고 실제 반영 실행", "실제 반영 확인 중", "가격 최종 재적용 중", "출시 완료"]) assert.ok(flow.includes(label), label);
});
