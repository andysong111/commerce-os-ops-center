import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lib = await readFile("src/lib/shopling/shoplingBcodeIndexReconciliation.ts", "utf8");
const integration = await readFile("src/app/api/integrations/shopling-bcode-index-reconciliation/route.ts", "utf8");
const proxy = await readFile("src/app/api/internal/aaa022-bde7-reconciliation/route.ts", "utf8");
const page = await readFile("src/app/aaa022-bde7-reconciliation/page.tsx", "utf8");
const admin = await readFile("src/lib/supabase/admin.ts", "utf8");

test("샵플링 B코드 인덱스 조정은 숫자 옵션바코드가 아닌 위치코드 캐시만 직렬 변경한다", () => {
  assert.match(lib, /for \(const entry of input\.entries\)/);
  assert.match(lib, /SHOPLING_INDEX_RECONCILIATION_READBACK_FAILED/);
  assert.match(lib, /previousBCode/);
  assert.match(lib, /currentBCode/);
  assert.doesNotMatch(lib, /optBarcode|option_barcode_no/);
  assert.match(admin, /delete\(\)/);
  assert.match(admin, /method === "DELETE"/);
});

test("외부 연동은 서버 비밀키로 잠그고 운영자 UI는 Product Master 프록시만 호출한다", () => {
  assert.match(integration, /x-commerce-os-integration-secret/);
  assert.match(integration, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(proxy, /resolveProductLaunchIdentity/);
  assert.match(proxy, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.doesNotMatch(page, /PRODUCT_MASTER_INTEGRATION_SECRET|x-commerce-os-integration-secret/);
  assert.match(page, /AAA022BDE7실물적재확인/);
});
